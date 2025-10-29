import { NextResponse } from "next/server";

// Placeholder cron endpoint. Configure Vercel Cron to hit this route.
export async function GET() {
  // TODO: Query Calendar for upcoming events, generate briefs.
  return NextResponse.json({ ok: true, message: "cron stub" });
}

