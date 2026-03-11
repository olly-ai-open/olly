import { NextResponse } from "next/server";
import { runSchedulerTick } from "@olly/core";
import { authorizeCronRequest } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const auth = authorizeCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const startedAt = Date.now();
  const result = await runSchedulerTick();
  return NextResponse.json({
    ok: true,
    type: "scheduler",
    durationMs: Date.now() - startedAt,
    result,
  });
}
