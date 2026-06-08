import type { Job, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
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
import { getPrisma } from "./prisma-server";
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
  retried?: boolean;
}

export interface ClaimDueJobsOptions {
  limit?: number;
  now?: Date;
  lockTtlMs?: number;
}

const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export async function runJobById(jobId: string): Promise<RunJobResult> {
  const prisma = await getPrisma();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - DEFAULT_LOCK_TTL_MS);
  const lockToken = randomUUID();

  const claimed = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: { in: ["PENDING", "QUEUED"] },
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    } as any,
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      lockedAt: now,
      lockToken,
    } as any,
  });

  if (claimed.count !== 1) {
    return { jobId, status: "SKIPPED", error: "job_not_runnable" };
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || (job as any).lockToken !== lockToken) {
    return { jobId, status: "SKIPPED", error: "job_not_claimed" };
  }

  return runClaimedJob(prisma, job);
}

export async function claimDueJobs(
  prisma: PrismaClient,
  options: ClaimDueJobsOptions = {},
): Promise<Job[]> {
  const limit = options.limit ?? 25;
  const now = options.now ?? new Date();
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const staleBefore = new Date(now.getTime() - lockTtlMs);

  const candidates = await prisma.job.findMany({
    where: {
      status: { in: ["PENDING", "QUEUED"] },
      AND: [
        { OR: [{ runAt: null }, { runAt: { lte: now } }] },
        { OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }] },
      ],
    } as any,
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  const claimed: Job[] = [];
  for (const job of candidates) {
    const maxAttempts = Math.max(1, (job as any).maxAttempts ?? 5);
    if (job.attempts >= maxAttempts) {
      await prisma.job.updateMany({
        where: { id: job.id, status: { in: ["PENDING", "QUEUED"] } },
        data: {
          status: "FAILED",
          lastError: "max_attempts_exceeded",
          lockedAt: null,
          lockToken: null,
        } as any,
      });
      continue;
    }

    const lockToken = randomUUID();
    const update = await prisma.job.updateMany({
      where: {
        id: job.id,
        status: { in: ["PENDING", "QUEUED"] },
        OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
      } as any,
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        lockedAt: now,
        lockToken,
      } as any,
    });

    if (update.count !== 1) continue;
    const locked = await prisma.job.findUnique({
      where: { id: job.id },
    });
    if (locked && (locked as any).lockToken === lockToken) {
      claimed.push(locked);
    }
  }

  return claimed;
}

export async function runClaimedJob(
  prisma: PrismaClient,
  job: Job,
): Promise<RunJobResult> {
  if (job.status !== "RUNNING" || !(job as any).lockToken) {
    return { jobId: job.id, status: "SKIPPED", error: "job_not_claimed" };
  }

  let result: RunJobResult;
  try {
    await dispatchJob(prisma, job);
    await finalizeJob(prisma, job.id, (job as any).lockToken, {
      status: "DONE",
    });
    result = { jobId: job.id, status: "DONE" };
  } catch (err: any) {
    const message = err?.message || "unknown_error";
    result = await rescheduleFailedJob(prisma, job.id, (job as any).lockToken, message);
  } finally {
    await flushLangfuse();
  }

  return result;
}

export async function finalizeJob(
  prisma: PrismaClient,
  jobId: string,
  lockToken: string,
  result: { status: "DONE" },
): Promise<void> {
  if (result.status !== "DONE") return;
  await prisma.job.updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      lockToken,
    } as any,
    data: {
      status: "DONE",
      lastError: null,
      lockedAt: null,
      lockToken: null,
    } as any,
  });
}

export async function rescheduleFailedJob(
  prisma: PrismaClient,
  jobId: string,
  lockToken: string,
  error: string,
): Promise<RunJobResult> {
  const current = await prisma.job.findUnique({
    where: { id: jobId },
    select: { attempts: true },
  });

  const attempts = current?.attempts ?? 1;
  const maxAttempts = 5;
  if (attempts >= maxAttempts) {
    await prisma.job.updateMany({
      where: { id: jobId, status: "RUNNING", lockToken } as any,
      data: {
        status: "FAILED",
        lastError: error,
        lockedAt: null,
        lockToken: null,
      } as any,
    });
    return { jobId, status: "FAILED", error };
  }

  const nextRunAt = new Date(
    Date.now() + getRetryDelayMs(attempts),
  );
  await prisma.job.updateMany({
    where: { id: jobId, status: "RUNNING", lockToken } as any,
    data: {
      status: "PENDING",
      runAt: nextRunAt,
      lastError: error,
      lockedAt: null,
      lockToken: null,
    } as any,
  });

  return { jobId, status: "SKIPPED", error, retried: true };
}

function getRetryDelayMs(attempts: number): number {
  const index = Math.min(
    RETRY_BACKOFF_MINUTES.length - 1,
    Math.max(0, attempts - 1),
  );
  return RETRY_BACKOFF_MINUTES[index] * 60 * 1000;
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
        job.userId,
      );
      const ignorePatterns = normalizeIgnorePatterns(settings);

      let title = meeting?.title || null;
      let attendees: any[] =
        (Array.isArray(meeting?.attendees) ? (meeting?.attendees as any[]) : []) ||
        [];
      let fetchedEvent: any = null;

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
  const settings = await getUserSettingsCore(userId);
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