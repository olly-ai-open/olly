import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateEndOfDayBriefForUser } from "@/lib/endOfDayBriefs";
import { prisma } from "@/lib/prisma";
import { getUserSettings } from "@/lib/settings";
import { sendBriefEmail, sendBriefReadyWebPush } from "@olly/core";
import { flushLangfuse } from "@olly/core/src/telemetry/langfuse";

// en-CA formats as YYYY-MM-DD, so day strings compare lexicographically
function dayInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const scheduled = body?.scheduled === true;

  const briefTimeInput =
    typeof body?.briefTime === "string" ? body.briefTime : undefined;
  const briefTime = briefTimeInput ? new Date(briefTimeInput) : new Date();
  const windowHours =
    typeof body?.windowHours === "number" && body.windowHours > 0
      ? body.windowHours
      : 24;

  const effectiveBriefTime = Number.isNaN(briefTime.getTime())
    ? new Date()
    : briefTime;

  try {
    const settings = await getUserSettings(session.user.id);
    const timeZone = settings.timeZone || "UTC";
    if (
      dayInTimeZone(effectiveBriefTime, timeZone) >
      dayInTimeZone(new Date(), timeZone)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "future_not_allowed",
          message:
            "End of day summaries can't be generated for future dates.",
        },
        { status: 400 },
      );
    }

    const result = await generateEndOfDayBriefForUser({
      userId: session.user.id,
      briefTime: effectiveBriefTime,
      windowHours,
    });

    if (scheduled && result.briefId) {
      sendBriefReadyWebPush(prisma, {
        userId: session.user.id,
        briefId: result.briefId,
        kind: "EVENING_BRIEF",
      }).catch((err) => {
        console.error("Failed to send evening brief web push", err);
      });
    }
    if (result.briefId) {
      void sendBriefEmail(prisma, {
        userId: session.user.id,
        briefId: result.briefId,
        kind: "EVENING_BRIEF",
      });
    }
    if (result.briefId) {
      await flushLangfuse();
    }

    return NextResponse.json({
      ok: true,
      briefId: result.briefId,
      meetingId: result.meetingId,
    });
  } catch (error: any) {
    console.error("Failed to generate evening brief:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}
