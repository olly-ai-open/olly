import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAccessTokenFromAccount,
  getEventDetailsWithToken,
  searchDriveSnippetsWithToken,
  searchGmailSnippetsWithToken,
} from "@/lib/google";
import { generateBriefFromContext } from "@/lib/llm";
import { upsertMeetingFromEvent } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  linkBriefParticipants,
  linkMeetingParticipants,
  upsertPersonsForEmails,
} from "@/lib/people";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  let eventId: string | undefined;
  let wantsRedirect = false;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    eventId = body?.eventId as string | undefined;
    wantsRedirect = Boolean(body?.redirect);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    eventId = (form.get("eventId") as string) || undefined;
    wantsRedirect = (form.get("redirect") as string) === "1";
  }
  if (!eventId)
    return NextResponse.json(
      { ok: false, error: "missing eventId" },
      { status: 400 },
    );

  try {
    const account = await prisma.account.findFirst({
      where: { userId: session.user.id, provider: "google" },
    });
    if (!account)
      return NextResponse.json(
        { ok: false, error: "no_account" },
        { status: 404 },
      );
    const token = await getAccessTokenFromAccount(account);
    const event = await getEventDetailsWithToken(token, eventId);
    const userId = session.user.id;
    const meeting = await upsertMeetingFromEvent(userId, event);

    const titleQ = event.title?.split(/\s+/).slice(0, 6).join(" ");
    const attendees = ((event.attendees || []) as { email?: string | null }[])
      .map((a) => a.email)
      .filter(Boolean) as string[];
    const attendeeQuery = attendees
      .slice(0, 3)
      .map((e) => `"${e}"`)
      .join(" OR ");

    const driveQ = [titleQ, attendeeQuery].filter(Boolean).join(" ");
    const gmailQ = [
      titleQ,
      attendees
        .slice(0, 2)
        .map((e) => `from:${e}`)
        .join(" "),
      "newer_than:30d",
    ]
      .filter(Boolean)
      .join(" ");

    const [drive, gmail] = await Promise.all([
      searchDriveSnippetsWithToken(token, driveQ || event.title || ""),
      searchGmailSnippetsWithToken(token, gmailQ),
    ]);

    const brief = await generateBriefFromContext({
      meeting: {
        title: event.title,
        start: event.start,
        attendees: event.attendees,
        description: event.description,
      },
      drive,
      gmail,
    });

    const saved = await prisma.brief.create({
      data: {
        meetingId: meeting.id,
        content: brief.content as any,
        confidence: brief.confidence,
        sources: brief.sources as any,
      },
    });

    // People: upsert Person rows for attendees, and link to meeting/brief
    const personRows = await upsertPersonsForEmails(
      userId,
      ((event.attendees || []) as { email?: string | null }[]).map(
        (a) => a.email,
      ),
    );
    const personIds = personRows.map((p) => p.id);
    await linkMeetingParticipants(meeting.id, personIds);
    await linkBriefParticipants(saved.id, personIds);

    // Create ActionItems from structured suggested_actions if present
    const content: any = saved.content as any;
    const actions: string[] = Array.isArray(content?.suggested_actions)
      ? content.suggested_actions
      : [];
    if (actions.length) {
      await prisma.actionItem.createMany({
        data: actions.slice(0, 20).map((title) => ({
          userId,
          title,
          briefId: saved.id,
          status: "open",
        })),
      });
    }

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
    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
