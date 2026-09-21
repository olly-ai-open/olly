import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createSchedulingRequestCore,
  startSchedulingRequestCore,
} from "@olly/core";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requests = await prisma.schedulingRequest.findMany({
    where: { userId: session.user.id },
    include: { attendees: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ requests });
}

/** Create a scheduling request and immediately send the first outreach. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const durationMinutes = Number(body?.durationMinutes);
  const autoBook = body?.autoBook !== false;
  const autoAltTimes = body?.autoAltTimes !== false; // default: autonomous
  const autoAltDates = body?.autoAltDates === true; // default: ask first
  const constraints = body?.constraints || {};
  const attendees = Array.isArray(body?.attendees) ? body.attendees : [];

  if (!title) {
    return NextResponse.json({ error: "missing_title" }, { status: 400 });
  }
  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 480
  ) {
    return NextResponse.json(
      { error: "durationMinutes must be between 15 and 480" },
      { status: 400 },
    );
  }
  // Fixed time: the user already agreed a start with attendees elsewhere.
  // The window collapses to the meeting itself.
  const fixedStart = Date.parse(constraints?.fixedStartISO || "");
  const hasFixedStart = Number.isFinite(fixedStart);
  if (hasFixedStart && fixedStart < Date.now() - 5 * 60 * 1000) {
    return NextResponse.json(
      { error: "fixedStartISO must be in the future" },
      { status: 400 },
    );
  }
  const windowStart = hasFixedStart
    ? fixedStart
    : Date.parse(constraints?.windowStartISO || "");
  const windowEnd = hasFixedStart
    ? fixedStart + Math.round(durationMinutes) * 60 * 1000
    : Date.parse(constraints?.windowEndISO || "");
  if (
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd) ||
    windowEnd <= windowStart
  ) {
    return NextResponse.json(
      { error: "constraints must include a valid date window" },
      { status: 400 },
    );
  }
  const validAttendees = attendees.filter(
    (a: any) =>
      a &&
      typeof a.email === "string" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim()),
  );
  if (!validAttendees.length) {
    return NextResponse.json(
      { error: "at least one attendee with a valid email is required" },
      { status: 400 },
    );
  }

  try {
    const request = await createSchedulingRequestCore(prisma, session.user.id, {
      title,
      durationMinutes: Math.round(durationMinutes),
      constraints: {
        windowStartISO: new Date(windowStart).toISOString(),
        windowEndISO: new Date(windowEnd).toISOString(),
        timeOfDay: ["morning", "afternoon", "evening", "any"].includes(
          constraints?.timeOfDay,
        )
          ? constraints.timeOfDay
          : "any",
        notes: typeof constraints?.notes === "string" ? constraints.notes : "",
        ...(hasFixedStart && {
          fixedStartISO: new Date(fixedStart).toISOString(),
        }),
      },
      attendees: validAttendees.map((a: any) => ({
        email: a.email.trim(),
        name: typeof a.name === "string" ? a.name.trim() || null : null,
        required: a.required !== false,
      })),
      autoBook,
      autoAltTimes,
      autoAltDates,
    });

    try {
      const started = await startSchedulingRequestCore(prisma, request.id);
      return NextResponse.json({ request: { ...request, ...started } });
    } catch (startError: any) {
      // Keep the draft so the user can fix the underlying issue (usually
      // missing Google scopes) without retyping everything.
      const reason = startError?.message || "failed_to_start";
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: { status: "NEEDS_ATTENTION", attentionReason: reason },
      });
      return NextResponse.json(
        { request, error: "start_failed", message: reason },
        { status: 502 },
      );
    }
  } catch (error: any) {
    console.error("Failed to create scheduling request:", error);
    return NextResponse.json(
      { error: "create_failed", message: error?.message },
      { status: 500 },
    );
  }
}
