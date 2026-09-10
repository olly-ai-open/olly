import { getPrisma } from "./prisma-server";
import { computeNextRunAt } from "./scheduling";
import { claimDueJobs, runClaimedJob, type RunJobResult } from "./jobs";

const DEFAULT_MEETING_BRIEF_LEAD_MS = 5 * 60 * 1000;
const DEFAULT_MEETING_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
const DEFAULT_CALENDAR_SYNC_INTERVAL_MIN = 60;
const DEFAULT_CALENDAR_SYNC_LOOKAHEAD_HOURS = 24;
const DEFAULT_SCHEDULING_POLL_INTERVAL_MIN = 5;

export interface SchedulerTickOptions {
  now?: Date;
  scheduleBatchSize?: number;
  meetingBatchSize?: number;
}

export interface SchedulerTickResult {
  schedulesScanned: number;
  schedulesScheduled: number;
  calendarSyncJobsCreated: number;
  meetingJobsCreated: number;
  meetingJobsUpdated: number;
  schedulingPollJobsCreated: number;
}

export async function runSchedulerTick(
  options: SchedulerTickOptions = {},
): Promise<SchedulerTickResult> {
  const now = options.now ?? new Date();
  const scheduleBatchSize = options.scheduleBatchSize ?? 100;
  const meetingBatchSize = options.meetingBatchSize ?? 200;

  const prisma = await getPrisma();

  const dueSchedules = await prisma.schedule.findMany({
    where: {
      active: true,
      nextRunAt: { lte: now },
    },
    take: scheduleBatchSize,
  });

  let schedulesScheduled = 0;
  for (const schedule of dueSchedules) {
    const expectedNextRunAt = schedule.nextRunAt;
    const nextRunAt = computeNextRunAt(
      {
        timeZone: schedule.timeZone || "UTC",
        timeOfDay: schedule.timeOfDay,
        daysOfWeek: (schedule.daysOfWeek as number[] | null) || undefined,
      },
      now,
    );

    const claimed = await prisma.schedule.updateMany({
      where: {
        id: schedule.id,
        active: true,
        nextRunAt: expectedNextRunAt,
      },
      data: { nextRunAt },
    });

    if (claimed.count !== 1) {
      continue;
    }

    await prisma.job.create({
      data: {
        kind: schedule.type,
        payload: schedule.meta ?? {},
        status: "PENDING",
        userId: schedule.userId,
        runAt: now,
        scheduleId: schedule.id,
      },
    });
    schedulesScheduled += 1;
  }

  let calendarSyncJobsCreated = 0;
  const calendarSyncWindowStart = new Date(
    now.getTime() - DEFAULT_CALENDAR_SYNC_INTERVAL_MIN * 60 * 1000,
  );

  const accountsNeedingSync = await prisma.account.findMany({
    where: {
      provider: "google",
      OR: [{ access_token: { not: null } }, { refresh_token: { not: null } }],
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  for (const account of accountsNeedingSync) {
    const recentSync = await prisma.job.findFirst({
      where: {
        userId: account.userId,
        kind: "CALENDAR_SYNC",
        createdAt: { gte: calendarSyncWindowStart },
        status: { in: ["PENDING", "QUEUED", "RUNNING", "DONE"] },
      },
      select: { id: true },
    });
    if (recentSync) {
      continue;
    }

    await prisma.job.create({
      data: {
        kind: "CALENDAR_SYNC",
        payload: { lookaheadHours: DEFAULT_CALENDAR_SYNC_LOOKAHEAD_HOURS },
        status: "PENDING",
        userId: account.userId,
        runAt: now,
      },
    });
    calendarSyncJobsCreated += 1;
  }

  let meetingJobsCreated = 0;
  let meetingJobsUpdated = 0;
  const meetingWindowEnd = new Date(
    now.getTime() + DEFAULT_MEETING_LOOKAHEAD_MS,
  );
  const upcomingMeetings = await prisma.meeting.findMany({
    where: {
      startsAt: {
        gt: now,
        lte: meetingWindowEnd,
      },
      OR: [{ status: null }, { status: { notIn: ["ignored", "declined"] } }],
    },
    orderBy: { startsAt: "asc" },
    take: meetingBatchSize,
  });

  for (const meeting of upcomingMeetings) {
    const targetRunAt = new Date(
      meeting.startsAt.getTime() - DEFAULT_MEETING_BRIEF_LEAD_MS,
    );

    const existingJob = await prisma.job.findFirst({
      where: {
        kind: "MEETING_BRIEF",
        userId: meeting.userId,
        payload: {
          path: ["eventId"],
          equals: meeting.externalId,
        },
        status: {
          in: ["PENDING", "QUEUED", "RUNNING", "DONE"],
        },
      },
      select: { id: true, status: true, runAt: true },
    });

    if (existingJob) {
      if (
        (existingJob.status === "PENDING" || existingJob.status === "QUEUED") &&
        existingJob.runAt &&
        existingJob.runAt.getTime() !== targetRunAt.getTime()
      ) {
        await prisma.job.update({
          where: { id: existingJob.id },
          data: { runAt: targetRunAt },
        });
        meetingJobsUpdated += 1;
      }
      continue;
    }

    await prisma.job.create({
      data: {
        kind: "MEETING_BRIEF",
        payload: { eventId: meeting.externalId },
        status: "PENDING",
        userId: meeting.userId,
        runAt: targetRunAt,
      },
    });
    meetingJobsCreated += 1;
  }

  // Poll active meeting-scheduling negotiations for new email replies.
  let schedulingPollJobsCreated = 0;
  const pollDueBefore = new Date(
    now.getTime() - DEFAULT_SCHEDULING_POLL_INTERVAL_MIN * 60 * 1000,
  );
  const activeRequests = await prisma.schedulingRequest.findMany({
    where: {
      status: { in: ["AWAITING_REPLIES", "NEGOTIATING"] },
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lte: pollDueBefore } }],
    },
    select: { id: true, userId: true },
    take: 100,
  });

  for (const request of activeRequests) {
    const existingPoll = await prisma.job.findFirst({
      where: {
        kind: "SCHEDULING_POLL",
        userId: request.userId,
        payload: { path: ["requestId"], equals: request.id },
        status: { in: ["PENDING", "QUEUED", "RUNNING"] },
      },
      select: { id: true },
    });
    if (existingPoll) continue;

    await prisma.job.create({
      data: {
        kind: "SCHEDULING_POLL",
        payload: { requestId: request.id },
        status: "PENDING",
        userId: request.userId,
        runAt: now,
      },
    });
    schedulingPollJobsCreated += 1;
  }

  return {
    schedulesScanned: dueSchedules.length,
    schedulesScheduled,
    calendarSyncJobsCreated,
    meetingJobsCreated,
    meetingJobsUpdated,
    schedulingPollJobsCreated,
  };
}

export interface WorkerTickOptions {
  now?: Date;
  batchSize?: number;
  lockTtlMs?: number;
  timeBudgetMs?: number;
}

export interface WorkerTickResult {
  claimed: number;
  done: number;
  failed: number;
  retried: number;
  skipped: number;
  durationMs: number;
}

export async function runWorkerTick(
  options: WorkerTickOptions = {},
): Promise<WorkerTickResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 25;
  const lockTtlMs = options.lockTtlMs ?? 10 * 60 * 1000;
  const timeBudgetMs = options.timeBudgetMs ?? 50 * 1000;

  const prisma = await getPrisma();
  const startedAt = Date.now();

  const claimedJobs = await claimDueJobs(prisma, {
    now,
    limit: batchSize,
    lockTtlMs,
  });

  const stats: WorkerTickResult = {
    claimed: claimedJobs.length,
    done: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    durationMs: 0,
  };

  for (const job of claimedJobs) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeBudgetMs) {
      await prisma.job.updateMany({
        where: {
          id: job.id,
          status: "RUNNING",
          lockToken: (job as any).lockToken,
        } as any,
        data: {
          status: "PENDING",
          lockedAt: null,
          lockToken: null,
        } as any,
      });
      stats.skipped += 1;
      continue;
    }

    const result: RunJobResult = await runClaimedJob(prisma, job);
    if (result.status === "DONE") {
      stats.done += 1;
      continue;
    }
    if (result.status === "FAILED") {
      stats.failed += 1;
      continue;
    }
    if (result.retried) {
      stats.retried += 1;
      continue;
    }
    stats.skipped += 1;
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}
