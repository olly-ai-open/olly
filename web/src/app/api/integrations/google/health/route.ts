import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessTokenFromAccount } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const account = await prisma.account.findFirst({ where: { userId: session.user.id, provider: "google" } });
  if (!account) return NextResponse.json({ ok: true, result: { connected: false, reason: "no_account" } });
  try {
    const token = await getAccessTokenFromAccount(account);
    const resp = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!resp.ok) {
      const body = await resp.text();
      return NextResponse.json({ ok: true, result: { connected: false, reason: `calendar_health_failed: ${resp.status} ${body}` } });
    }
    return NextResponse.json({ ok: true, result: { connected: true } });
  } catch (e: any) {
    return NextResponse.json({ ok: true, result: { connected: false, reason: e?.message || "unknown_error" } });
  }
}
