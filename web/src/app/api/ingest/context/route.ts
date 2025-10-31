import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAccessTokenFromAccount,
  getEventDetailsWithToken,
  searchDriveSnippetsWithToken,
  searchGmailSnippetsWithToken,
} from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");
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

    return NextResponse.json({ ok: true, event, drive, gmail });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
