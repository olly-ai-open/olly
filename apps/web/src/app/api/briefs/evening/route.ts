import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateEndOfDayBriefForUser } from "@/lib/endOfDayBriefs";
import { type DebugDataStructure } from "@olly/core";

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

  const briefTimeInput =
    typeof body?.briefTime === "string" ? body.briefTime : undefined;
  const briefTime = briefTimeInput ? new Date(briefTimeInput) : new Date();
  const windowHours =
    typeof body?.windowHours === "number" && body.windowHours > 0
      ? body.windowHours
      : 24;

  const start = Date.now();
  const debugData: DebugDataStructure = {
    version: "1.0",
    summary: {
      briefId: "",
      userId: session.user.id,
      timestamp: new Date().toISOString(),
      totalDuration: 0,
      apiCalls: 0,
      success: false,
    },
    timeline: [],
    searchResults: {
      drive: { queries: [], totalFound: 0, included: 0, results: [] },
      gmail: { queries: [], totalFound: 0, included: 0, results: [] },
    },
    llmContext: {
      systemPrompt: "",
      userPrompt: "",
      model: "",
      temperature: 0,
      response: "",
    },
  };
  const addTimelineEntry = (action: string, details?: any) => {
    debugData.timeline.push({
      timestamp: Date.now() - start,
      action,
      ...details,
    });
  };
  addTimelineEntry("START", { details: "Evening brief generation initiated" });

  try {
    const result = await generateEndOfDayBriefForUser({
      userId: session.user.id,
      briefTime: Number.isNaN(briefTime.getTime()) ? new Date() : briefTime,
      windowHours,
      debug: {
        debugData,
        addTimelineEntry,
      },
    });

    return NextResponse.json({
      ok: true,
      briefId: result.briefId,
      meetingId: result.meetingId,
    });
  } catch (error: any) {
    debugData.summary.success = false;
    debugData.summary.error = error?.message || "failed";
    debugData.summary.totalDuration = Date.now() - start;
    addTimelineEntry("ERROR", { error: error?.message || "failed" });
    console.error("Failed to generate evening brief:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}
