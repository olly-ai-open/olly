import type { PrismaClient } from "@prisma/client";
import { getUserSettingsCore } from "./settings-core";
import { EndOfDayBriefAgent } from "../agents/personas/EndOfDayBriefAgent";

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

export async function generateEndOfDayBriefForUserCore(
  prisma: PrismaClient,
  userId: string,
  opts?: {
    briefTime?: Date;
    windowHours?: number;
  },
) {
  const briefTime = opts?.briefTime ?? new Date();
  const windowHours = opts?.windowHours ?? 24;

  const settings = await getUserSettingsCore(userId);
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

  const systemPromptOverride =
    typeof (settings as any)?.endOfDayBriefSystemPrompt === "string" &&
    (settings as any).endOfDayBriefSystemPrompt.trim().length
      ? (settings as any).endOfDayBriefSystemPrompt.trim()
      : undefined;
  const agent = new EndOfDayBriefAgent({
    systemPrompt: systemPromptOverride,
    telemetryEnabled: settings.telemetryOptIn !== false,
  });
  const summary = await agent.generateEndOfDaySummaryFromWorkspace(userId, {
    briefTime: briefTime.toISOString(),
    windowHours,
    timeZone,
    assigneeLabel: "user",
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

  return {
    meetingId: meeting.id as string,
    briefId: savedBrief.id as string,
    summary,
    briefMarkdown,
  };
}
