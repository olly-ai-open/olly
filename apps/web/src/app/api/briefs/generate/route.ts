import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { S3DebugStorage, createBriefDebugContext } from "@olly/core";
import { getUserSearchStrategy, getUserSettings } from "@/lib/settings";
import {
  generateMeetingBriefForEvent,
  type MeetingBriefSearchStrategy,
} from "@/lib/meetingBriefs";

export async function POST(req: Request) {
  const debug = createBriefDebugContext();
  const debugData = debug.debugData;
  const addTimelineEntry = debug.addTimelineEntry.bind(debug);
  addTimelineEntry("START", { details: "Brief generation initiated" });

  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );

  debugData.summary.userId = session.user.id;

  const QUERY_STRATEGY_LLM_ONLY = "LLM_ONLY" as const;
  const QUERY_STRATEGY_HEURISTIC_ONLY = "HEURISTIC_ONLY" as const;
  const QUERY_STRATEGY_LLM_AND_HEURISTIC = "LLM_AND_HEURISTIC" as const;
  type QueryStrategy = MeetingBriefSearchStrategy;

  let eventId: string | undefined;
  let wantsRedirect = false;
  let searchStrategy: QueryStrategy = QUERY_STRATEGY_LLM_ONLY;
  let searchStrategyFromBody: QueryStrategy | null = null;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    eventId = body?.eventId as string | undefined;
    wantsRedirect = Boolean(body?.redirect);
    if (typeof body?.searchStrategy === "string") {
      const candidate = body.searchStrategy as string;
      if (
        candidate === QUERY_STRATEGY_LLM_ONLY ||
        candidate === QUERY_STRATEGY_HEURISTIC_ONLY ||
        candidate === QUERY_STRATEGY_LLM_AND_HEURISTIC
      ) {
        searchStrategyFromBody = candidate as QueryStrategy;
      } else {
        // Backwards-compatible aliases
        if (candidate === "llm") {
          searchStrategyFromBody = QUERY_STRATEGY_LLM_ONLY;
        } else if (candidate === "llm+heuristic") {
          searchStrategyFromBody = QUERY_STRATEGY_LLM_AND_HEURISTIC;
        } else if (candidate === "heuristic") {
          searchStrategyFromBody = QUERY_STRATEGY_HEURISTIC_ONLY;
        }
      }
    }
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

  addTimelineEntry("EVENT_LOADED", { details: `Event ID: ${eventId}` });

  try {
    // Resolve search strategy: request override > user setting > default
    const savedSearchStrategy = await getUserSearchStrategy(session.user.id);
    if (searchStrategyFromBody) {
      searchStrategy = searchStrategyFromBody;
    } else if (savedSearchStrategy === "LLM_ONLY") {
      searchStrategy = QUERY_STRATEGY_LLM_ONLY;
    } else if (savedSearchStrategy === "LLM_AND_HEURISTIC") {
      searchStrategy = QUERY_STRATEGY_LLM_AND_HEURISTIC;
    } else if (savedSearchStrategy === "HEURISTIC_ONLY") {
      searchStrategy = QUERY_STRATEGY_HEURISTIC_ONLY;
    } else {
      searchStrategy = QUERY_STRATEGY_LLM_ONLY;
    }

    // Preload user settings so we don't re-fetch inside helper
    const userSettings = await getUserSettings(session.user.id);

    const { briefId } = await generateMeetingBriefForEvent({
      userId: session.user.id,
      eventId,
      searchStrategy,
      userSettings,
      debug: {
        debugData,
        addTimelineEntry,
      },
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

      if (meeting?.status === "declined") {
        return NextResponse.json(
          { ok: false, error: "event_declined" },
          { status: 409 },
        );
      }
      if (meeting?.status === "ignored") {
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

    debug.markSuccess(briefId, session.user.id);
    addTimelineEntry("BRIEF_SAVED", { briefId });

    const saved = await prisma.brief.findUnique({
      where: { id: briefId },
    });
    if (!saved) {
      throw new Error("brief_not_found");
    }

    // Mark success and calculate final duration
    addTimelineEntry("COMPLETE", {
      details: "Brief generation completed successfully",
      totalDuration: debugData.summary.totalDuration,
    });

    // Upload debug data to S3 if enabled
    if (S3DebugStorage.isEnabled()) {
      try {
        const uploadResult = await debug.uploadIfEnabled(
          saved.id,
          session.user.id,
        );

        if (uploadResult.success && uploadResult.s3Key) {
          await prisma.brief.update({
            where: { id: saved.id },
            data: {
              debugS3Key: uploadResult.s3Key,
              debugCapturedAt: new Date(),
              debugMetadata: debug.getMetadata(),
            },
          });
          console.log(`Debug data saved to S3 for brief ${saved.id}`);
        }
      } catch (s3Error) {
        console.error("Failed to save debug data to S3:", s3Error);
      }
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
    // Capture error in debug data
    debug.markError(err, { userId: session.user.id });
    addTimelineEntry("ERROR", {
      error: err?.message || "unknown error",
      stack: err?.stack,
    });

    if (S3DebugStorage.isEnabled() && debugData.summary.briefId) {
      try {
        await debug.uploadIfEnabled(debugData.summary.briefId, session.user.id);
      } catch (s3Error) {
        console.error("Failed to save error debug data to S3:", s3Error);
      }
    }

    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
