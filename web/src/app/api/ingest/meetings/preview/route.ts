import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAccessTokenFromAccount, listUpcomingMeetingsWithToken } from "@/lib/google";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const account = await prisma.account.findFirst({ where: { userId: session.user.id, provider: "google" } });
    if (!account) return NextResponse.json({ ok: false, error: "no_account" }, { status: 404 });
    const token = await getAccessTokenFromAccount(account);
    const events = await listUpcomingMeetingsWithToken(token, { windowMinutes: 90 });
    return NextResponse.json({ ok: true, events });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "failed" }, { status: 500 });
  }
}
