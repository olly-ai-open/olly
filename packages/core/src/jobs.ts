import type { Job, PrismaClient } from "@prisma/client";
import { generateMeetingBriefForEventCore } from "./core/meetingBriefs-core";
import {
  getUserSettingsCore,
  type UserSettings,
} from "./core/settings-core";
import { getAccessTokenFromAccountCore } from "./core/google-core";
import { listEventsByDayWithToken } from "./google-http";
import { generateMorningBrief } from "./llm";
import { getPrisma } from "./prisma-lambda";

export type JobKind = "MORNING_BRIEF" | "EVENING_BRIEF" | "MEETING_BRIEF";

export interface RunJobResult {
  jobId: string;
  status: "DONE" | "FAILED" | "SKIPPED";
  error?: string;
}

/**
 * Entry point for running a single job by ID.
 * Intended to be called from background workers.
 */
export async function runJobById(jobId: string): Promise<RunJobResult> {
  const prisma = await getPrisma();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { jobId, status: "SKIPPED", error: "job_not_found" };
  }

  if (job.status !== "PENDING" && job.status !== "QUEUED") {
    return { jobId, status: "SKIPPED", error: "job_not_runnable" };
  }

  try {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: job.attempts + 1 },
    });

    await dispatchJob(prisma, job);

    await prisma.job.update({
      where: { id: job.id },
      data: { status: "DONE", lastError: null },
    });

    return { jobId: job.id, status: "DONE" };
  } catch (err: any) {
    const message = err?.message || "unknown_error";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message },
    });
    return { jobId: job.id, status: "FAILED", error: message };
  }
}

async function dispatchJob(prisma: PrismaClient, job: Job): Promise<void> {
  const kind = job.kind as JobKind;
  const payload = (job.payload ?? {}) as any;

  switch (kind) {
    case "MORNING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_morning_brief");
      }
      const dayISO =
        typeof payload.dayISO === "string" ? payload.dayISO : undefined;
      await generateMorningBriefForUser(prisma, job.userId, dayISO);
      return;
    }
    case "MEETING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_meeting_brief");
      }
      const eventId = payload.eventId as string | undefined;
      if (!eventId) {
        throw new Error("missing_eventId_for_meeting_brief");
      }

      const settings: UserSettings = await getUserSettingsCore(
        prisma,
        job.userId,
      );
      const searchStrategy =
        (settings.searchStrategy as any as
          | "LLM_ONLY"
          | "HEURISTIC_ONLY"
          | "LLM_AND_HEURISTIC") || "HEURISTIC_ONLY";

      await generateMeetingBriefForEventCore(prisma, {
        userId: job.userId,
        eventId,
        searchStrategy,
        userSettings: settings,
        persist: true,
      });
      return;
    }
    case "EVENING_BRIEF": {
      // Placeholder for future implementation.
      // For now, mark as no-op.
      return;
    }
    default:
      throw new Error(`unsupported_job_kind:${job.kind}`);
  }
}

/**
 * Minimal re-use of the existing morning-brief flow for background jobs.
 * This intentionally omits debug/S3 logging present in the HTTP handler.
 */
async function generateMorningBriefForUser(
  prisma: PrismaClient,
  userId: string,
  dayISOOverride?: string,
): Promise<void> {
  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";

  const now = new Date();
  const dayISO = dayISOOverride ?? toDayInTimeZone(now, timeZone);

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) {
    throw new Error("no_account");
  }

  const token = await getAccessTokenFromAccountCore(
    prisma,
    account as any,
  );
  const events = await listEventsByDayWithToken(token, dayISO, timeZone);

  const meetingsForBrief = events.map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.start,
    attendees: event.attendees || [],
    status: (event as any).status || null,
    description: event.description || null,
  }));

  const actionItems = await prisma.actionItem.findMany({
    where: {
      userId,
      status: "open",
      dueAt: {
        gte: new Date(dayISO),
      },
    },
  });

  const actionItemsForBrief = actionItems.map((ai) => ({
    id: ai.id,
    title: ai.title,
    dueAt: ai.dueAt ? ai.dueAt.toISOString() : null,
    status: ai.status as string,
  }));

  const morning = await generateMorningBrief(
    {
      day: dayISO,
      timeZone,
      meetings: meetingsForBrief,
      actionItems: actionItemsForBrief,
    },
    {
      systemPromptOverride: settings.morningBriefSystemPrompt ?? undefined,
    },
  );

  const externalId = `morning:${dayISO}`;
  const morningMeeting = await prisma.meeting.upsert({
    where: { userId_externalId: { userId, externalId } },
    update: {
      title: `Morning Brief ${dayISO}`,
      type: "morning",
    },
    create: {
      userId,
      externalId,
      title: `Morning Brief ${dayISO}`,
      startsAt: new Date(),
      endsAt: null,
      type: "morning",
      status: "generated",
    },
  });

  await prisma.brief.create({
    data: {
      meetingId: morningMeeting.id,
      content: {
        brief_markdown: morning.brief_markdown,
        highlighted_action_item_ids: morning.highlightedActionItemIds,
      } as any,
    },
  });
}

function toDayInTimeZone(now: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return `${obj.year}-${obj.month}-${obj.day}`;
}
