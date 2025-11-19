import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAccessTokenFromAccount,
  listEventsByDayWithToken,
} from "@/lib/google";
import { getUserSearchStrategy, getUserSettings } from "@/lib/settings";
import { generateMorningBrief } from "@/lib/llm";
import {
  generateMeetingBriefForEvent,
  type MeetingBriefSearchStrategy,
} from "@/lib/meetingBriefs";
import { S3DebugStorage, type DebugDataStructure } from "@/lib/s3-debug";

function toDayInTimeZone(now: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return `${obj.year}-${obj.month}-${obj.day}`;
}

export async function POST(req: Request) {
  const startTime = Date.now();

  // NOTE: Ephemeral meeting-brief mode:
  // When true, we treat per-meeting briefs used during morning-brief generation
  // as ephemeral: generateMeetingBriefForEvent is called with persist=false so
  // no Meeting/Brief rows are created or updated.
  const USE_EPHEMERAL_MEETING_BRIEFS_FOR_MORNING = true;

  const debugData: DebugDataStructure = {
    version: "1.0",
    summary: {
      briefId: "",
      userId: "",
      timestamp: new Date().toISOString(),
      totalDuration: 0,
      apiCalls: 0,
      success: false,
    },
    timeline: [],
    searchResults: {
      drive: {
        queries: [],
        totalFound: 0,
        included: 0,
        results: [],
        errors: [],
      },
      gmail: {
        queries: [],
        totalFound: 0,
        included: 0,
        results: [],
        errors: [],
      },
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
      timestamp: Date.now() - startTime,
      action,
      ...details,
    });
  };

  addTimelineEntry("START", {
    details: "Morning brief generation initiated",
  });

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const userId = session.user.id;
  debugData.summary.userId = userId;

  let body: any = {};
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await req.json().catch(() => ({}));
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    body = { day: form.get("day") as string | null };
  }

  try {
    const settings = await getUserSettings(userId);
    const timeZone = settings.timeZone || "UTC";
    const todayISO = toDayInTimeZone(new Date(), timeZone);
    const dayISO =
      typeof body?.day === "string" && body.day.trim().length
        ? body.day.trim()
        : todayISO;

    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "no_account" },
        { status: 404 },
      );
    }

    const token = await getAccessTokenFromAccount(account);
    const events = await listEventsByDayWithToken(token, dayISO, timeZone);

    // Look up existing meetings and their latest briefs (for goals)
    const eventIds = events.map((e: any) => e.id as string);
    const existingMeetings = await prisma.meeting.findMany({
      where: { userId, externalId: { in: eventIds } },
      include: {
        briefs: { orderBy: { generatedAt: "desc" }, take: 1 },
      },
    });

    const existingByExternalId = new Map<
      string,
      (typeof existingMeetings)[number]
    >();
    for (const m of existingMeetings) {
      existingByExternalId.set(m.externalId as string, m);
    }

    // Decide search strategy for per-event meeting briefs
    const savedSearchStrategy = await getUserSearchStrategy(userId);
    let searchStrategy: MeetingBriefSearchStrategy = "HEURISTIC_ONLY";
    if (savedSearchStrategy === "LLM_ONLY") {
      searchStrategy = "LLM_ONLY";
    } else if (savedSearchStrategy === "LLM_AND_HEURISTIC") {
      searchStrategy = "LLM_AND_HEURISTIC";
    }

    const goalsByExternalId = new Map<string, string[]>();
    for (const m of existingMeetings as any[]) {
      const latest = m.briefs?.[0];
      if (!latest) continue;
      const c: any = latest.content as any;
      const goals: string[] = Array.isArray(c?.goals)
        ? (c.goals as any[])
            .map((g: any) => (typeof g === "string" ? g.trim() : ""))
            .filter(Boolean)
        : [];
      if (goals.length) {
        goalsByExternalId.set(m.externalId as string, goals.slice(0, 5));
      }
    }

    // For events without a stored brief/goals, generate an in-memory brief
    // (no DB writes) to extract goals for the morning summary.
    for (const evt of events as any[]) {
      const externalId = evt.id as string;
      if (goalsByExternalId.has(externalId)) continue;

      try {
        const result = await generateMeetingBriefForEvent({
          userId,
          eventId: externalId,
          searchStrategy,
          token,
          userSettings: settings,
          persist: !USE_EPHEMERAL_MEETING_BRIEFS_FOR_MORNING ? true : false,
          debug: {
            debugData,
            addTimelineEntry,
          },
        });
        const content: any = result.content as any;
        const goals: string[] = Array.isArray(content?.goals)
          ? (content.goals as any[])
              .map((g: any) => (typeof g === "string" ? g.trim() : ""))
              .filter(Boolean)
          : [];
        if (goals.length) {
          goalsByExternalId.set(externalId, goals.slice(0, 5));
        }
      } catch (e) {
        console.error(
          "Failed to generate ephemeral meeting brief for event",
          externalId,
          e,
        );
      }
    }

    const meetingsForBrief = events.map((e: any) => ({
      id: e.id as string,
      title: (e.title as string) || "(no title)",
      start: e.start || null,
      goals: goalsByExternalId.get(e.id as string) ?? [],
    }));

    // Candidate action items: open/self tasks, limited set
    const actionItemsDb = await prisma.actionItem.findMany({
      where: {
        userId,
        OR: [{ status: null }, { status: { in: ["open", "todo"] } }],
      },
      include: {
        assignees: { include: { person: true } },
        brief: {
          include: {
            meeting: true,
            people: { include: { person: true } },
          },
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    });

    const actionItemsForBrief = actionItemsDb.map((ai: any) => {
      const relatedPeopleSet = new Map<
        string,
        { name?: string | null; email?: string | null }
      >();

      for (const a of ai.assignees || []) {
        if (a.person) {
          relatedPeopleSet.set(a.person.id, {
            name: a.person.name,
            email: a.person.email,
          });
        }
      }
      for (const bp of ai.brief?.people || []) {
        if (bp.person) {
          relatedPeopleSet.set(bp.person.id, {
            name: bp.person.name,
            email: bp.person.email,
          });
        }
      }

      const relatedMeetings: string[] = [];
      if (ai.brief?.meeting) {
        relatedMeetings.push(ai.brief.meeting.id as string);
      }

      return {
        id: ai.id as string,
        title: ai.title as string,
        dueAt: ai.dueAt ? (ai.dueAt as Date).toISOString() : null,
        status: (ai.status as string) || null,
        relatedMeetings,
        relatedPeople: Array.from(relatedPeopleSet.values()),
      };
    });

    const morning = await generateMorningBrief(
      {
        day: dayISO,
        timeZone,
        meetings: meetingsForBrief,
        actionItems: actionItemsForBrief,
      },
      {
        systemPromptOverride: settings.morningBriefSystemPrompt ?? undefined,
      },
    );
    debugData.llmContext = morning.llmContext;
    debugData.summary.apiCalls += 1;

    // Create a synthetic "meeting" to host the morning brief
    const externalId = `morning:${dayISO}`;
    const morningMeeting = await prisma.meeting.upsert({
      where: { userId_externalId: { userId, externalId } },
      update: {
        title: `Morning Brief ${dayISO}`,
        type: "morning",
      },
      create: {
        userId,
        externalId,
        title: `Morning Brief ${dayISO}`,
        startsAt: new Date(),
        endsAt: null,
        type: "morning",
        status: "generated",
      },
    });

    const saved = await prisma.brief.create({
      data: {
        meetingId: morningMeeting.id,
        content: {
          brief_markdown: morning.brief_markdown,
          highlighted_action_item_ids: morning.highlightedActionItemIds,
        } as any,
      },
    });

    debugData.summary.briefId = saved.id;
    debugData.summary.success = true;
    debugData.summary.totalDuration = Date.now() - startTime;
    addTimelineEntry("MORNING_BRIEF_SAVED", { briefId: saved.id });
    addTimelineEntry("COMPLETE", {
      details: "Morning brief generation completed successfully",
      totalDuration: debugData.summary.totalDuration,
    });

    if (S3DebugStorage.isEnabled()) {
      try {
        const s3Storage = new S3DebugStorage();
        const uploadResult = await s3Storage.uploadDebugData(
          saved.id,
          userId,
          debugData,
        );

        if (uploadResult.success && uploadResult.s3Key) {
          await prisma.brief.update({
            where: { id: saved.id },
            data: {
              debugS3Key: uploadResult.s3Key,
              debugCapturedAt: new Date(),
              debugMetadata: {
                totalDuration: debugData.summary.totalDuration,
                apiCalls: debugData.summary.apiCalls,
                driveResults: debugData.searchResults.drive.totalFound,
                gmailResults: debugData.searchResults.gmail.totalFound,
                timelineEvents: debugData.timeline.length,
              },
            },
          });
          console.log(`Debug data saved to S3 for morning brief ${saved.id}`);
        }
      } catch (s3Error) {
        console.error(
          "Failed to save morning brief debug data to S3:",
          s3Error,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      briefId: saved.id,
      highlightedActionItemIds: morning.highlightedActionItemIds,
    });
  } catch (error: any) {
    console.error("Failed to generate morning brief:", error);
    debugData.summary.success = false;
    debugData.summary.error = error?.message || "unknown error";
    debugData.summary.totalDuration = Date.now() - startTime;
    addTimelineEntry("ERROR", {
      error: error?.message || "unknown error",
      stack: error?.stack,
    });

    if (S3DebugStorage.isEnabled() && debugData.summary.briefId) {
      try {
        const s3Storage = new S3DebugStorage();
        await s3Storage.uploadDebugData(
          debugData.summary.briefId,
          debugData.summary.userId,
          debugData,
        );
      } catch (s3Error) {
        console.error(
          "Failed to save error debug data for morning brief:",
          s3Error,
        );
      }
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}
