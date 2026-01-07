import type { Job, PrismaClient } from "@prisma/client";
import { generateMeetingBriefForEventCore } from "./core/meetingBriefs-core";
import { generateMorningBriefForUserCore } from "./core/morningBriefs-core";
import { generateEndOfDayBriefForUserCore } from "./core/endOfDayBriefs-core";
import { upsertMeetingFromEventCore } from "./core/meetings-core";
import {
  getUserSettingsCore,
  type UserSettings,
} from "./core/settings-core";
import { getAccessTokenFromAccountCore } from "./core/google-core";
import {
  listEventsInRangeWithToken,
  getEventDetailsWithToken,
} from "./google-http";
import { getPrisma } from "./prisma-lambda";
import {
  normalizeIgnorePatterns,
  shouldIgnoreEventByTitle,
  didUserDeclineEvent,
} from "./core/eventFilters-core";
import { sendBriefReadyWebPush } from "./core/webPush-core";
import { flushLangfuse } from "./telemetry/langfuse";

export type JobKind =
  | "MORNING_BRIEF"
  | "EVENING_BRIEF"
  | "MEETING_BRIEF"
  | "CALENDAR_SYNC";

export interface RunJobResult {
  jobId: string;
  status: "DONE" | "FAILED" | "SKIPPED";
  error?: string;
}

export async function runJobById(jobId: string): Promise<RunJobResult> {
  const prisma = await getPrisma();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { jobId, status: "SKIPPED", error: "job_not_found" };
  }

  if (job.status !== "PENDING" && job.status !== "QUEUED") {
    return { jobId, status: "SKIPPED", error: "job_not_runnable" };
  }

  let result: RunJobResult;
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

    result = { jobId: job.id, status: "DONE" };
  } catch (err: any) {
    const message = err?.message || "unknown_error";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message },
    });

    result = { jobId: job.id, status: "FAILED", error: message };
  } finally {
    await flushLangfuse();
  }
  return result;
}

async function dispatchJob(
  prisma: PrismaClient,
  job: Job
): Promise<void> {
  const kind = job.kind as JobKind;
  const payload = (job.payload ?? {}) as any;

  switch (kind) {
    case "MORNING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_morning_brief");
      }
      const dayISO =
        typeof payload.dayISO === "string" ? payload.dayISO : undefined;
      const { briefId } = await generateMorningBriefForUserCore(
        prisma,
        job.userId,
        dayISO
      );
      if (briefId) {
        sendBriefReadyWebPush(prisma, {
          userId: job.userId,
          briefId,
          kind: "MORNING_BRIEF",
        }).catch((err) => {
          console.error("Failed to send morning brief web push", err);
        });
      }
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

      const meeting = await prisma.meeting.findUnique({
        where: {
          userId_externalId: {
            userId: job.userId,
            externalId: eventId,
          },
        },
      });
      if (meeting?.status === "ignored" || meeting?.status === "declined") {
        return;
      }

      const settings: UserSettings = await getUserSettingsCore(
        prisma,
        job.userId,
      );
      const ignorePatterns = normalizeIgnorePatterns(settings);

      // Pre-flight ignore/decline check with best available data (meeting record + fetched event)
      let title = meeting?.title || null;
      let attendees: any[] =
        (Array.isArray(meeting?.attendees) ? (meeting?.attendees as any[]) : []) ||
        [];
      let fetchedEvent: any = null;

      // Fetch event if we're missing title/attendees or need organizer-derived context
      const account = await prisma.account.findFirst({
        where: { userId: job.userId, provider: "google" },
      });
      if (!account) throw new Error("no_account_for_meeting_brief");
      const token = await getAccessTokenFromAccountCore(prisma, account as any);

      if (!title || attendees.length === 0) {
        fetchedEvent = await getEventDetailsWithToken(token, eventId);
        title = title || fetchedEvent.title || null;
        if (attendees.length === 0 && Array.isArray(fetchedEvent.attendees)) {
          attendees = fetchedEvent.attendees;
        }
      }

      const accountEmail = account.providerAccountId || null;
      const userEmail =
        (await prisma.user.findUnique({
          where: { id: job.userId },
          select: { email: true },
        }))?.email || null;
      const currentUserEmail = userEmail || accountEmail || null;

      if (
        currentUserEmail &&
        didUserDeclineEvent(attendees as any, { currentUserEmail })
      ) {
        const eventData = fetchedEvent || meeting;
        await upsertMeetingFromEventCore(prisma, job.userId, {
          id: eventId,
          title: title || "(no title)",
          start: eventData?.start,
          end: eventData?.end,
          attendees: eventData?.attendees || [],
          description: eventData?.description || null,
          status: "declined",
        });
        return;
      }

      if (
        ignorePatterns.length &&
        title &&
        shouldIgnoreEventByTitle(title, ignorePatterns)
      ) {
        const eventData = fetchedEvent || meeting;
        await upsertMeetingFromEventCore(prisma, job.userId, {
          id: eventId,
          title: title || "(no title)",
          start: eventData?.start,
          end: eventData?.end,
          attendees: eventData?.attendees || [],
          description: eventData?.description || null,
          status: "ignored",
        });
        return;
      }

      const result = await generateMeetingBriefForEventCore(prisma, {
        userId: job.userId,
        eventId,
        userSettings: settings,
        persist: true,
      });
      
      if (result.briefId) {
        sendBriefReadyWebPush(prisma, {
          userId: job.userId,
          briefId: result.briefId,
          kind: "MEETING_BRIEF",
        }).catch((err) => {
          console.error("Failed to send meeting brief web push", err);
        });
      }
      return;
    }
    case "EVENING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_evening_brief");
      }
      const briefTimeInput = payload.briefTime as string | undefined;
      const briefTime = briefTimeInput ? new Date(briefTimeInput) : new Date();
      const windowHours =
        typeof payload.windowHours === "number"
          ? payload.windowHours
          : 24;

      const result = await generateEndOfDayBriefForUserCore(prisma, job.userId, {
        briefTime: Number.isNaN(briefTime.getTime())
          ? new Date()
          : briefTime,
        windowHours,
      });

      if (result.briefId) {
        sendBriefReadyWebPush(prisma, {
          userId: job.userId,
          briefId: result.briefId,
          kind: "EVENING_BRIEF",
        }).catch((err) => {
          console.error("Failed to send evening brief web push", err);
        });
      }
      return;
    }
    case "CALENDAR_SYNC": {
      if (!job.userId) {
        throw new Error("missing_userId_for_calendar_sync");
      }
      const lookaheadHours =
        typeof payload.lookaheadHours === "number"
          ? payload.lookaheadHours
          : 24;
      await syncCalendarForUser(
        prisma,
        job.userId,
        lookaheadHours
      );
      return;
    }
    default:
      throw new Error(`unsupported_job_kind:${job.kind}`);
  }
}

async function syncCalendarForUser(
  prisma: PrismaClient,
  userId: string,
  lookaheadHours: number
): Promise<void> {
  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) {
    throw new Error("no_account_for_calendar_sync");
  }

  if (!account.access_token && !account.refresh_token) {
    return;
  }

  const token = await getAccessTokenFromAccountCore(prisma, account as any);

  const now = new Date();
  const timeMin = now;
  const timeMax = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

  let events: Array<{
    id: string;
    title: string;
    start?: string | null;
    end?: string | null;
    attendees?: { email?: string | null }[];
    description?: string | null;
  }> = [];
  try {
    events = await listEventsInRangeWithToken(token, timeMin, timeMax);
  } catch (err: any) {
    return;
  }
  const ignorePatterns = normalizeIgnorePatterns(settings);
  let ignoredCount = 0;

  let upserted = 0;
  for (const event of events) {
    const isIgnored =
      ignorePatterns.length &&
      shouldIgnoreEventByTitle(event.title, ignorePatterns);
    if (isIgnored) ignoredCount += 1;

    await upsertMeetingFromEventCore(prisma, userId, {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
      description: event.description,
      status: isIgnored ? "ignored" : null,
    });
    upserted += 1;
  }
}
