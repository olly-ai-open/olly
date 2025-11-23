import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { getPrisma, computeNextRunAt } from "@olly/core";

const sqs = new SQSClient({});
const JOB_QUEUE_URL = process.env.JOB_QUEUE_URL;

export async function handler(): Promise<void> {
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

  // 2. Enqueue due jobs to SQS
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
