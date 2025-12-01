import { NextRequest, NextResponse } from "next/server";
import { subDays } from "date-fns";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULT_RANGE_DAYS = 30;

function parseRangeDays(req: NextRequest): number {
  const url = new URL(req.url);
  const raw = url.searchParams.get("range");
  if (!raw) return DEFAULT_RANGE_DAYS;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_RANGE_DAYS;
  return Math.min(Math.max(parsed, 1), 365);
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "number") return value;
  return 0;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  if (!admin?.isAdmin) {
    return NextResponse.json(
      { ok: false, error: "forbidden" },
      { status: 403 },
    );
  }

  const rangeDays = parseRangeDays(req);
  const since = subDays(new Date(), rangeDays);
  const now = new Date();
  const sevenDaysAgo = subDays(now, 7);

  const [
    backlogRows,
    briefsPerDay,
    feedbackRows,
    readRows,
    schedulesByType,
    totalBriefs,
    activeBriefUsersRows,
    scheduledUsersRows,
    coverageRows,
    syncRows,
    syncJobStatusRows,
    actionItemRows,
  ] = await prisma.$transaction([
    prisma.$queryRaw<{ pending: number; max_age_minutes: number | null }[]>`
      SELECT count(*)::int AS pending,
             max(EXTRACT(EPOCH FROM (now() - "runAt"))/60)::float AS max_age_minutes
      FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= now()
    `,
    prisma.$queryRaw<
      { day: string; meeting_type: string | null; briefs: number }[]
    >`
      SELECT date(b."generatedAt") AS day,
             coalesce(m.type, 'meeting') AS meeting_type,
             count(*)::int AS briefs
      FROM "Brief" b
      JOIN "Meeting" m ON m.id = b."meetingId"
      WHERE b."generatedAt" >= ${since}
      GROUP BY day, meeting_type
      ORDER BY day
    `,
    prisma.$queryRaw<{ thumb: string | null; count: number }[]>`
      SELECT (b.feedback->>'thumb') AS thumb, count(*)::int AS count
      FROM "Brief" b
      WHERE b.feedback IS NOT NULL
      GROUP BY thumb
    `,
    prisma.$queryRaw<
      { read: number; total: number; avg_minutes: number | null }[]
    >`
      SELECT
        count(*) FILTER (WHERE b."readAt" IS NOT NULL)::int AS read,
        count(*)::int AS total,
        avg(EXTRACT(EPOCH FROM (b."readAt" - b."generatedAt"))/60)::float AS avg_minutes
      FROM "Brief" b
      WHERE b."generatedAt" >= ${since}
    `,
    prisma.schedule.groupBy({
      by: ["type"],
      where: { active: true },
      _count: true,
      orderBy: { type: "asc" },
    }),
    prisma.brief.count({
      where: { generatedAt: { gte: since } },
    }),
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(DISTINCT m."userId")::int AS count
      FROM "Brief" b
      JOIN "Meeting" m ON m.id = b."meetingId"
      WHERE b."generatedAt" >= ${sevenDaysAgo}
    `,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(DISTINCT "userId")::int AS count
      FROM "Schedule"
      WHERE active = true
    `,
    prisma.$queryRaw<{ meetings: number; briefs: number }[]>`
      WITH recent_meetings AS (
        SELECT id
        FROM "Meeting"
        WHERE "startsAt" >= ${subDays(now, 7)} AND status IS DISTINCT FROM 'ignored'
      )
      SELECT
        (SELECT count(*) FROM recent_meetings) AS meetings,
        (SELECT count(*) FROM "Brief" b WHERE b."meetingId" IN (SELECT id FROM recent_meetings)) AS briefs
    `,
    prisma.$queryRaw<{ total_users: number; stale_users: number }[]>`
      SELECT
        count(DISTINCT a."userId")::int AS total_users,
        count(
          DISTINCT CASE
            WHEN s.last_sync IS NULL OR s.last_sync < now() - interval '24 hours'
            THEN a."userId"
          END
        )::int AS stale_users
      FROM "Account" a
      LEFT JOIN (
        SELECT "userId", max("createdAt") AS last_sync
        FROM "Job"
        WHERE kind = 'CALENDAR_SYNC'
        GROUP BY "userId"
      ) s ON s."userId" = a."userId"
      WHERE a.provider = 'google'
    `,
    prisma.job.groupBy({
      by: ["status"],
      where: {
        kind: "CALENDAR_SYNC",
        createdAt: { gte: since },
      },
      _count: true,
      orderBy: { status: "asc" },
    }),
    prisma.$queryRaw<
      {
        created: number;
        resolved: number;
        with_due: number;
        without_due: number;
        overdue: number;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE "createdAt" >= ${since})::int AS created,
        count(*) FILTER (WHERE "completedAt" IS NOT NULL AND "completedAt" >= ${since})::int AS resolved,
        count(*) FILTER (WHERE "dueAt" IS NOT NULL)::int AS with_due,
        count(*) FILTER (WHERE "dueAt" IS NULL)::int AS without_due,
        count(*) FILTER (WHERE "dueAt" IS NOT NULL AND "dueAt" < now() AND "completedAt" IS NULL)::int AS overdue
      FROM "ActionItem"
    `,
  ]);

  const backlog = backlogRows[0] || { pending: 0, max_age_minutes: 0 };
  const feedback = feedbackRows.reduce(
    (acc, row) => {
      const thumb = row.thumb;
      const cnt = toNumber(row.count);
      if (thumb === "up") acc.up += cnt;
      else if (thumb === "down") acc.down += cnt;
      else acc.other += cnt;
      return acc;
    },
    { up: 0, down: 0, other: 0 },
  );

  const readRow = readRows[0] || { read: 0, total: 0, avg_minutes: 0 };
  const activeBriefUsers = toNumber(activeBriefUsersRows[0]?.count);
  const scheduleUsers = toNumber(scheduledUsersRows[0]?.count);
  const coverage = {
    meetings: toNumber(coverageRows[0]?.meetings),
    briefs: toNumber(coverageRows[0]?.briefs),
  };
  const sync = {
    total_users: toNumber(syncRows[0]?.total_users),
    stale_users: toNumber(syncRows[0]?.stale_users),
  };

  return NextResponse.json({
    ok: true,
    rangeDays,
    summary: {
      briefsGenerated: totalBriefs,
      activeBriefUsers,
      feedbackUpRate:
        feedback.up + feedback.down === 0
          ? 0
          : feedback.up / (feedback.up + feedback.down),
      jobsBacklog: toNumber(backlog.pending),
    },
    jobs: {
      backlog: {
        pending: toNumber(backlog.pending),
        maxAgeMinutes: toNumber(backlog.max_age_minutes),
      },
    },
    briefs: {
      perDay: briefsPerDay.map((row) => ({
        day: row.day,
        meetingType: row.meeting_type ?? "meeting",
        briefs: row.briefs,
      })),
      feedback,
      read: {
        read: toNumber(readRow.read),
        total: toNumber(readRow.total),
        avgMinutesToRead: toNumber(readRow.avg_minutes),
      },
      coverage,
    },
    schedules: {
      activeUsers: scheduleUsers,
      byType: schedulesByType.map((row) => ({
        type: row.type,
        count:
          typeof row._count === "object"
            ? toNumber((row._count as any)._all)
            : toNumber((row as any)._count),
      })),
    },
    sync: {
      totalUsers: sync.total_users || 0,
      staleUsers: sync.stale_users || 0,
      jobsByStatus: syncJobStatusRows.map((row) => ({
        status: row.status,
        count:
          typeof row._count === "object"
            ? toNumber((row._count as any)._all)
            : toNumber((row as any)._count),
      })),
    },
    actionItems: {
      created: toNumber(actionItemRows[0]?.created),
      resolved: toNumber(actionItemRows[0]?.resolved),
      withDue: toNumber(actionItemRows[0]?.with_due),
      withoutDue: toNumber(actionItemRows[0]?.without_due),
      overdue: toNumber(actionItemRows[0]?.overdue),
    },
  });
}
