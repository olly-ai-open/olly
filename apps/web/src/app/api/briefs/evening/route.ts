import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateEndOfDayBriefForUser } from "@/lib/endOfDayBriefs";
import { prisma } from "@/lib/prisma";
import { sendBriefReadyWebPush } from "@olly/core";

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

  const start = Date.now();

  try {
    const result = await generateEndOfDayBriefForUser({
      userId: session.user.id,
      briefTime: Number.isNaN(briefTime.getTime()) ? new Date() : briefTime,
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
