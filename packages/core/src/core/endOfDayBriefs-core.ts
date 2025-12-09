import type { PrismaClient } from "@prisma/client";
import { S3DebugStorage, type DebugDataStructure } from "../s3-debug";
import { getUserSettingsCore } from "./settings-core";
import { generateEndOfDaySummary } from "../llm";
import { runWorkspaceQueryPlan } from "./briefQueries-core";

type NormalizedDoc = {
  id: string;
  title: string;
  source: string;
  updatedAt: string;
  link?: string | null;
  docType?: string | null;
  text: string;
};

function toDayInTimeZone(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return `${obj.year}-${obj.month}-${obj.day}`;
}

function parseDueDate(value?: string | null): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatEndOfDayMarkdown(input: {
  highlights: string[];
  risks: string[];
  docs: { title: string; link?: string | null; source?: string | null }[];
}): string {
  const lines: string[] = [];
  lines.push("## Highlights & Decisions");
  if (input.highlights.length) lines.push(...input.highlights.map((h) => `- ${h}`));
  else lines.push("- None.");
  lines.push("");
  lines.push("## Risks & Blockers");
  if (input.risks.length) lines.push(...input.risks.map((r) => `- ${r}`));
  else lines.push("- None.");
  lines.push("");
  return lines.join("\n");
}

function dedupeDocs(docs: NormalizedDoc[]): NormalizedDoc[] {
  const seen = new Map<string, NormalizedDoc>();
  for (const d of docs) {
    const key =
      (d.title || "").toLowerCase().replace(/\s+/g, " ").trim() ||
      d.id;
    if (!seen.has(key)) seen.set(key, d);
  }
  return Array.from(seen.values());
}

export async function generateEndOfDayBriefForUserCore(
  prisma: PrismaClient,
  userId: string,
  opts?: {
    briefTime?: Date;
    windowHours?: number;
    debug?: {
      debugData: DebugDataStructure;
      addTimelineEntry: (action: string, details?: any) => void;
    };
  },
) {
  const briefTime = opts?.briefTime ?? new Date();
  const windowHours = opts?.windowHours ?? 24;
  const windowEnd = briefTime;
  const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);
  const startedAt = Date.now();
  const debugData = opts?.debug?.debugData ?? null;
  const addTimeline =
    opts?.debug?.addTimelineEntry ??
    (() => {
      /* noop */
    });

  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });

  let selfPersonId: string | null = null;
  if (user?.email) {
    const existingPerson = await prisma.person.findFirst({
      where: { userId, email: user.email },
    });
    if (existingPerson) {
      selfPersonId = existingPerson.id as string;
    } else {
      const createdPerson = await prisma.person.create({
        data: {
          userId,
          email: user.email,
          name: user.name || user.email,
        },
      });
      selfPersonId = createdPerson.id as string;
    }
  }

  const slackWindowQueries = ["status", "update", "decision", "action item"];

  const { drive, gmail, slack } = await runWorkspaceQueryPlan(
    prisma,
    userId,
    {
      driveQueries: [],
      gmailQueries: [],
      slackQueries: slackWindowQueries,
      windowStart,
      windowEnd,
      maxResults: 25,
    },
    { debugData, addTimelineEntry: addTimeline },
  );

  const docs: NormalizedDoc[] = [];
  for (const f of drive as any[]) {
    if (!f?.text?.trim()) continue;
    docs.push({
      id: f.id as string,
      title: (f.name as string) || "(untitled)",
      source: "google_drive",
      updatedAt: f.modifiedTime || windowEnd.toISOString(),
      link: (f as any).webViewLink || null,
      docType: (f as any).mimeType || null,
      text: (f.text as string).trim(),
    });
  }
  for (const m of gmail as any[]) {
    if (!m?.text?.trim()) continue;
    const headers = Array.isArray(m.payload?.headers) ? m.payload.headers : [];
    const subject =
      headers.find(
        (h: any) => h.name?.toLowerCase() === "subject",
      )?.value ||
      m.snippet ||
      "(no subject)";
    const from =
      headers.find((h: any) => h.name?.toLowerCase() === "from")?.value ||
      "(unknown sender)";
    const to =
      headers.find((h: any) => h.name?.toLowerCase() === "to")?.value ||
      "(unknown recipients)";
    const headerBlock = `From: ${from}\nTo: ${to}\n\n`;
    docs.push({
      id: m.id as string,
      title: subject,
      source: "gmail",
      updatedAt: m.internalDate
        ? new Date(Number(m.internalDate)).toISOString()
        : windowEnd.toISOString(),
      link: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
      docType: "email",
      text: `${headerBlock}${(m.text as string).trim()}`,
    });
  }
  for (const m of slack as any[]) {
    if (!m?.text || !String(m.text).trim()) continue;
    const tsMs =
      typeof m.ts === "string" && !Number.isNaN(Number(m.ts))
        ? Math.floor(Number(m.ts) * 1000)
        : null;
    const updatedAt =
      tsMs && Number.isFinite(tsMs)
        ? new Date(tsMs).toISOString()
        : windowEnd.toISOString();
    const channelLabel = m.channel?.name ? `#${m.channel.name}` : "Slack";
    docs.push({
      id: (m.id as string) || `${m.channel?.id || "slack"}-${m.ts || "msg"}`,
      title:
        String(m.text).trim().slice(0, 120) ||
        `${channelLabel} message (${updatedAt})`,
      source: "slack",
      updatedAt,
      link: (m.permalink as string) || null,
      docType: channelLabel,
      text: `${channelLabel}\n${String(m.text).trim()}`,
    });
  }

  const deduped = dedupeDocs(docs);
  addTimeline("DOCS_DEDUPED", { count: deduped.length });
  if (debugData?.searchResults?.drive) {
    debugData.searchResults.drive.included = deduped.filter(
      (d) => d.source === "google_drive",
    ).length;
  }
  if (debugData?.searchResults?.gmail) {
    debugData.searchResults.gmail.included = deduped.filter(
      (d) => d.source === "gmail",
    ).length;
  }
  if (debugData?.searchResults?.slack) {
    debugData.searchResults.slack.included = deduped.filter(
      (d) => d.source === "slack",
    ).length;
  }

  const summary = await generateEndOfDaySummary({
    briefTime: briefTime.toISOString(),
    windowHours,
    documents: deduped.map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      updatedAt: d.updatedAt,
      link: d.link,
      docType: d.docType,
      text: d.text,
    })),
    assigneeLabel: "user",
    systemPromptOverride: (settings as any)?.endOfDayBriefSystemPrompt ?? undefined,
  });
  if (debugData?.summary) debugData.summary.apiCalls += 1;
  if (debugData) {
    debugData.llmContext = summary.llmContext;
  }
  addTimeline("LLM_COMPLETE", {
    highlights: summary.highlights.length,
    risks: summary.risks.length,
    actions: summary.actionItems.length,
    docs: summary.docs.length,
  });

  const briefMarkdown = formatEndOfDayMarkdown({
    highlights: summary.highlights,
    risks: summary.risks,
    docs: summary.docs,
  });

  const dayISO = toDayInTimeZone(briefTime, timeZone);
  const externalId = `evening:${dayISO}`;

  const meeting = await prisma.meeting.upsert({
    where: { userId_externalId: { userId, externalId } },
    update: {
      title: `End of Day Summary ${dayISO}`,
      type: "evening",
      startsAt: briefTime,
    },
    create: {
      userId,
      externalId,
      title: `End of Day Summary ${dayISO}`,
      startsAt: briefTime,
      endsAt: null,
      type: "evening",
      status: "generated",
    },
  });

  const savedBrief = await prisma.brief.create({
    data: {
      meetingId: meeting.id,
      content: {
        brief_markdown: briefMarkdown,
        highlights: summary.highlights,
        risks: summary.risks,
        action_items: summary.actionItems,
        docs: summary.docs,
      } as any,
      sources: summary.docs.map((d) => {
        const parts = [d.source, d.title].filter(Boolean).join(": ");
        return d.link ? `${parts} -> ${d.link}` : parts;
      }),
    },
  });
  addTimeline("BRIEF_SAVED", { briefId: savedBrief.id });

  for (const ai of summary.actionItems) {
    const dueAt = parseDueDate(ai.dueDate);
    const created = await prisma.actionItem.create({
      data: {
        userId,
        title: ai.title,
        dueAt,
        status: "open",
        briefId: savedBrief.id,
        sourceRef: ai.link
          ? ({ link: ai.link, source: ai.source } as any)
          : undefined,
      },
    });
    if (selfPersonId) {
      await prisma.actionItemAssignee.create({
        data: { actionItemId: created.id, personId: selfPersonId },
      });
    }
  }
  addTimeline("ACTION_ITEMS_CREATED", { count: summary.actionItems.length });

  if (debugData) {
    debugData.summary.briefId = savedBrief.id;
    debugData.summary.userId = userId;
    debugData.summary.success = true;
    debugData.summary.totalDuration = Date.now() - startedAt;
    addTimeline("COMPLETE", { duration: debugData.summary.totalDuration });

    if (S3DebugStorage.isEnabled()) {
      try {
        const s3Storage = new S3DebugStorage();
        const upload = await s3Storage.uploadDebugData(
          savedBrief.id,
          userId,
          debugData,
        );
        if (upload.success && upload.s3Key) {
          await prisma.brief.update({
            where: { id: savedBrief.id },
            data: {
              debugS3Key: upload.s3Key,
              debugCapturedAt: new Date(),
              debugMetadata: {
                totalDuration: debugData.summary.totalDuration,
                apiCalls: debugData.summary.apiCalls,
                driveResults: debugData.searchResults.drive.totalFound,
                gmailResults: debugData.searchResults.gmail.totalFound,
                slackResults: debugData.searchResults.slack.totalFound,
                timelineEvents: debugData.timeline.length,
              },
            },
          });
        }
      } catch {
        // swallow
      }
    }
  }

  return {
    meetingId: meeting.id as string,
    briefId: savedBrief.id as string,
    summary,
    briefMarkdown,
    debugData,
  };
}
