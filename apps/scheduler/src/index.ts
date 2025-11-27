import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { getPrisma, computeNextRunAt } from "@olly/core";
import { initializeEnvironment } from "./init-env";

const sqs = new SQSClient({});
const JOB_QUEUE_URL = process.env.JOB_QUEUE_URL;
const MEETING_BRIEF_LEAD_MS = 5 * 60 * 1000; // 5 minutes
const MEETING_LOOKAHEAD_MS = 2 * 60 * 60 * 1000; // 2 hours
const CALENDAR_SYNC_INTERVAL_MIN = 60; // 1 hour
const CALENDAR_SYNC_LOOKAHEAD_HOURS = 24; // 24 hours

// Initialize environment at module load (cold start)
const envInitPromise = initializeEnvironment();

export async function handler(): Promise<void> {
  // Ensure environment is initialized before processing
  await envInitPromise;
  if (!JOB_QUEUE_URL) {
    console.warn("JOB_QUEUE_URL not configured; scheduler exiting");
    return;
  }

  const now = new Date();

  const prisma = await getPrisma();

  // 1. Turn due schedules into jobs
  const dueSchedules = await prisma.schedule.findMany({
    where: {
      active: true,
      nextRunAt: {
        lte: now,
      },
    },
    take: 100,
  });

  for (const schedule of dueSchedules) {
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

    const next = computeNextRunAt(
      {
        timeZone: schedule.timeZone || "UTC",
        timeOfDay: schedule.timeOfDay,
        daysOfWeek: (schedule.daysOfWeek as any as number[]) || undefined,
      },
      now,
    );

    await prisma.schedule.update({
      where: { id: schedule.id },
      data: { nextRunAt: next },
    });
  }

  // 2. Enqueue calendar sync jobs on a slower cadence
  const calendarSyncWindowStart = new Date(
    now.getTime() - CALENDAR_SYNC_INTERVAL_MIN * 60 * 1000,
  );

  const accountsNeedingSync = await prisma.account.findMany({
    where: { provider: "google" },
    select: { userId: true },
    distinct: ["userId"],
  });

  for (const acct of accountsNeedingSync) {
    const recentSync = await prisma.job.findFirst({
      where: {
        userId: acct.userId,
        kind: "CALENDAR_SYNC",
        createdAt: { gte: calendarSyncWindowStart },
        status: { in: ["PENDING", "QUEUED", "RUNNING", "DONE"] },
      },
    });
    if (recentSync) continue;

    await prisma.job.create({
      data: {
        kind: "CALENDAR_SYNC",
        payload: { lookaheadHours: CALENDAR_SYNC_LOOKAHEAD_HOURS },
        status: "PENDING",
        userId: acct.userId,
        runAt: now,
      },
    });
  }

  // 3. Schedule meeting briefs 5 minutes before meeting start
  const meetingWindowEnd = new Date(now.getTime() + MEETING_LOOKAHEAD_MS);
  const upcomingMeetings = await prisma.meeting.findMany({
    where: {
      startsAt: {
        gt: now,
        lte: meetingWindowEnd,
      },
    },
    orderBy: { startsAt: "asc" },
    take: 200,
  });

  for (const meeting of upcomingMeetings) {
    const targetRunAt = new Date(
      meeting.startsAt.getTime() - MEETING_BRIEF_LEAD_MS,
    );

    const existingJob = await prisma.job.findFirst({
      where: {
        kind: "MEETING_BRIEF",
        userId: meeting.userId,
        payload: {
          path: ["eventId"],
          equals: meeting.externalId,
        },
        status: { in: ["PENDING", "QUEUED", "RUNNING", "DONE"] },
      },
    });

    if (existingJob) {
      if (
        (existingJob.status === "PENDING" ||
          existingJob.status === "QUEUED") &&
        existingJob.runAt &&
        existingJob.runAt.getTime() !== targetRunAt.getTime()
      ) {
        await prisma.job.update({
          where: { id: existingJob.id },
          data: { runAt: targetRunAt },
        });
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
  }

  // 4. Enqueue due jobs to SQS
  const dueJobs = await prisma.job.findMany({
    where: {
      status: "PENDING",
      runAt: {
        lte: now,
      },
    },
    take: 50,
  });

  if (!dueJobs.length) return;

  const entries = dueJobs.map((job) => ({
    Id: job.id,
    MessageBody: JSON.stringify({ jobId: job.id }),
  }));

  // Mark as queued before sending to avoid double-enqueue
  await prisma.job.updateMany({
    where: { id: { in: dueJobs.map((j) => j.id) } },
    data: { status: "QUEUED" },
  });

  const batches: (typeof entries)[] = [];
  for (let i = 0; i < entries.length; i += 10) {
    batches.push(entries.slice(i, i + 10));
  }

  for (const batch of batches) {
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: JOB_QUEUE_URL,
        Entries: batch,
      }),
    );
  }
}
