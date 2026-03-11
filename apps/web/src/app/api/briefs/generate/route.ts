import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { sendBriefReadyWebPush } from "@olly/core";
import { flushLangfuse } from "@olly/core/src/telemetry/langfuse";
import { getUserSettings } from "@/lib/settings";
import { generateMeetingBriefForEvent } from "@/lib/meetingBriefs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );

  let eventId: string | undefined;
  let wantsRedirect = false;
  let forceGenerate = false;
  let scheduled = false;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    eventId = body?.eventId as string | undefined;
    wantsRedirect = Boolean(body?.redirect);
    forceGenerate = Boolean(body?.force);
    scheduled = body?.scheduled === true;
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    eventId = (form.get("eventId") as string) || undefined;
    wantsRedirect = (form.get("redirect") as string) === "1";
    forceGenerate = (form.get("force") as string) === "1";
  }
  if (!eventId)
    return NextResponse.json(
      { ok: false, error: "missing eventId" },
      { status: 400 },
    );

  try {
    // Preload user settings so we don't re-fetch inside helper
    const userSettings = await getUserSettings(session.user.id);

    const { briefId } = await generateMeetingBriefForEvent({
      userId: session.user.id,
      eventId,
      userSettings,
      force: forceGenerate,
    });

    if (!briefId) {
      const meeting = await prisma.meeting.findUnique({
        where: {
          userId_externalId: {
            userId: session.user.id,
            externalId: eventId,
          },
        },
        select: { status: true },
      });

      if (!forceGenerate && meeting?.status === "declined") {
        return NextResponse.json(
          { ok: false, error: "event_declined" },
          { status: 409 },
        );
      }
      if (!forceGenerate && meeting?.status === "ignored") {
        return NextResponse.json(
          { ok: false, error: "event_ignored" },
          { status: 409 },
        );
      }

      return NextResponse.json(
        { ok: false, error: "brief_not_persisted" },
        { status: 409 },
      );
    }

    const saved = await prisma.brief.findUnique({
      where: { id: briefId },
    });
    if (!saved) {
      throw new Error("brief_not_found");
    }

    if (scheduled) {
      sendBriefReadyWebPush(prisma, {
        userId: session.user.id,
        briefId: saved.id,
        kind: "MEETING_BRIEF",
      }).catch((err) => {
        console.error("Failed to send meeting brief web push", err);
      });
    }
    await flushLangfuse();

    // Revalidate dashboard; detail page is a fresh navigation
    try {
      revalidatePath("/");
    } catch {}

    if (wantsRedirect) {
      const url = new URL(`/briefs/${saved.id}`, req.url);
      url.searchParams.set("t", Date.now().toString());
      return NextResponse.redirect(url);
    }
    return NextResponse.json({ ok: true, brief: saved });
  } catch (err: any) {
    console.error("Failed to generate meeting brief:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
