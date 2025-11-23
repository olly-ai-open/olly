import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeNextRunAt, type JobKind } from "@olly/core";
import { getUserSettings } from "@/lib/settings";
import { Prisma } from "@prisma/client";

type AllowedJobKind = Extract<JobKind, "MORNING_BRIEF" | "EVENING_BRIEF">;

// GET /api/schedules - list schedules for current user
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const schedules = await prisma.schedule.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(schedules);
}

interface UpsertScheduleBody {
  type: AllowedJobKind;
  timeOfDay: string;
  daysOfWeek?: number[];
  active?: boolean;
}

// PUT /api/schedules - create or update a schedule for the current user
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: UpsertScheduleBody;
  try {
    body = (await req.json()) as UpsertScheduleBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { type, timeOfDay, daysOfWeek, active } = body;

  if (type !== "MORNING_BRIEF" && type !== "EVENING_BRIEF") {
    return NextResponse.json(
      { error: "unsupported_schedule_type" },
      { status: 400 },
    );
  }

  if (typeof timeOfDay !== "string" || !/^\d{2}:\d{2}$/.test(timeOfDay)) {
    return NextResponse.json(
      { error: "timeOfDay must be HH:MM (24h)" },
      { status: 400 },
    );
  }

  if (daysOfWeek !== undefined) {
    if (!Array.isArray(daysOfWeek)) {
      return NextResponse.json(
        { error: "daysOfWeek must be an array of 0-6" },
        { status: 400 },
      );
    }
    const invalid = daysOfWeek.some(
      (d) => typeof d !== "number" || d < 0 || d > 6,
    );
    if (invalid) {
      return NextResponse.json(
        { error: "daysOfWeek entries must be between 0 and 6" },
        { status: 400 },
      );
    }
  }

  const settings = await getUserSettings(userId);
  const timeZone = settings.timeZone || "UTC";

  const nextRunAt = computeNextRunAt(
    {
      timeZone,
      timeOfDay,
      daysOfWeek,
    },
    new Date(),
  );

  const existing = await prisma.schedule.findFirst({
    where: {
      userId,
      type,
    },
  });

  const data: Prisma.ScheduleUncheckedCreateInput = {
    userId,
    type,
    timeZone,
    timeOfDay,
    daysOfWeek:
      daysOfWeek !== undefined
        ? (daysOfWeek as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    active: active ?? true,
    nextRunAt,
    meta: {} as Prisma.InputJsonValue,
  };

  const schedule = existing
    ? await prisma.schedule.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.schedule.create({ data });

  return NextResponse.json(schedule);
}
