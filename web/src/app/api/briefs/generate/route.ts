import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAccessTokenFromAccount,
  getEventDetailsWithToken,
  getDriveFilesByIdsWithToken,
} from "@/lib/google";
import {
  generateBriefFromContext,
  generateSearchQueriesForEvent,
} from "@/lib/llm";
import { upsertMeetingFromEvent } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  inferAttendeesFromTitle,
  linkBriefParticipants,
  linkMeetingParticipants,
  upsertPersonsForEmails,
} from "@/lib/people";
import { WorkspaceSearch } from "@/lib/workspaceSearch";
import {
  buildDriveHeuristicQueries,
  buildGmailHeuristicQueries,
} from "@/lib/searchHeuristics";
import { S3DebugStorage, type DebugDataStructure } from "@/lib/s3-debug";
import { getUserSearchStrategy, getUserSettings } from "@/lib/settings";

const MAX_PARTICIPANTS = 10;

export async function POST(req: Request) {
  const startTime = Date.now();

  // Initialize debug data structure
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
  type QueryStrategy =
    | typeof QUERY_STRATEGY_LLM_ONLY
    | typeof QUERY_STRATEGY_HEURISTIC_ONLY
    | typeof QUERY_STRATEGY_LLM_AND_HEURISTIC;

  let eventId: string | undefined;
  let wantsRedirect = false;
  let searchStrategy: QueryStrategy = QUERY_STRATEGY_HEURISTIC_ONLY;
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
    const account = await prisma.account.findFirst({
      where: { userId: session.user.id, provider: "google" },
    });
    if (!account)
      return NextResponse.json(
        { ok: false, error: "no_account" },
        { status: 404 },
      );
    const token = await getAccessTokenFromAccount(account);

    // Resolve search strategy: request override > user setting > default
    const savedSearchStrategy = await getUserSearchStrategy(session.user.id);
    if (searchStrategyFromBody) {
      searchStrategy = searchStrategyFromBody;
    } else if (savedSearchStrategy === "LLM_ONLY") {
      searchStrategy = QUERY_STRATEGY_LLM_ONLY;
    } else if (savedSearchStrategy === "LLM_AND_HEURISTIC") {
      searchStrategy = QUERY_STRATEGY_LLM_AND_HEURISTIC;
    } else {
      searchStrategy = QUERY_STRATEGY_HEURISTIC_ONLY;
    }

    const event = await getEventDetailsWithToken(token, eventId);
    const userId = session.user.id;
    const meeting = await upsertMeetingFromEvent(userId, event);
    const workspaceSearch = new WorkspaceSearch(userId);

    // Get user settings (timeframe + prompt overrides)
    const userSettings = await getUserSettings(userId);
    const searchTimeframeDays = userSettings.searchTimeframeDays;
    const briefSystemPromptOverride = userSettings.briefSystemPrompt ?? null;
    const queryPlannerSystemPromptOverride =
      userSettings.queryPlannerSystemPrompt ?? null;

    // Calendar attachments (e.g., Drive files attached to the invite)
    let driveAttachments: any[] = [];
    try {
      const rawAttachments = ((event as any)?.raw?.attachments || []) as any[];
      const driveAttachmentIds = rawAttachments
        .map((a: any) => a.fileId)
        .filter(Boolean) as string[];
      if (driveAttachmentIds.length) {
        driveAttachments = await getDriveFilesByIdsWithToken(
          token,
          driveAttachmentIds,
        );
        if (driveAttachments.length) {
          addTimelineEntry("CALENDAR_ATTACHMENTS", {
            count: driveAttachments.length,
            fileIds: driveAttachments.map((f: any) => f.id),
          });
        }
      }
    } catch (attachmentError: any) {
      addTimelineEntry("CALENDAR_ATTACHMENTS_ERROR", {
        error: attachmentError?.message || "unknown_error",
      });
    }

    const titleQ = event.title
      ?.split(/\s+/)
      .slice(0, MAX_PARTICIPANTS)
      .join(" ");
    const attendees = ((event.attendees || []) as { email?: string | null }[])
      .map((a) => a.email)
      .filter(Boolean) as string[];

    // If no attendees but we have a title, try to extract names and find people
    let inferredAttendees: string[] = [];
    let extractedNames: string[] = [];
    if (attendees.length === 0 && event.title) {
      const inferred = await inferAttendeesFromTitle(userId, event.title);
      inferredAttendees = inferred.inferredAttendees;
      extractedNames = inferred.namesFromTitle;

      if (inferred.inferredAttendees.length > 0) {
        addTimelineEntry("INFERRED_ATTENDEES", {
          details: `Found ${inferred.inferredAttendees.length} people from title: ${inferred.namesFromTitle.join(", ")}`,
          emails: inferred.inferredAttendees,
        });
      } else if (inferred.namesFromTitle.length > 0) {
        addTimelineEntry("NAMES_NOT_FOUND", {
          details: `Extracted names from title but not found in contacts: ${inferred.namesFromTitle.join(", ")} - will search for them in Gmail content`,
        });
      }
    }

    // Use inferred attendees if we don't have real attendees
    const effectiveAttendees =
      attendees.length > 0 ? attendees : inferredAttendees;

    // Optional: use LLM to propose Drive/Gmail search queries for this event
    let llmDriveQueries: string[] = [];
    let llmGmailQueries: string[] = [];
    if (
      searchStrategy === QUERY_STRATEGY_LLM_ONLY ||
      searchStrategy === QUERY_STRATEGY_LLM_AND_HEURISTIC
    ) {
      addTimelineEntry("LLM_QUERY_PLANNER_START", {
        strategy: searchStrategy,
      });
      try {
        const planned = await generateSearchQueriesForEvent(
          {
            meeting: {
              title: event.title,
              start: event.start,
              attendees: event.attendees || [],
              description: event.description,
            },
          },
          {
            systemPromptOverride: queryPlannerSystemPromptOverride ?? undefined,
          },
        );
        llmDriveQueries = planned.driveQueries;
        llmGmailQueries = planned.gmailQueries;
        addTimelineEntry("LLM_QUERY_PLANNER_COMPLETE", {
          driveQueries: llmDriveQueries,
          gmailQueries: llmGmailQueries,
        });
      } catch (plannerError: any) {
        addTimelineEntry("LLM_QUERY_PLANNER_ERROR", {
          error: plannerError?.message || "unknown_error",
        });
      }
    }

    // For Drive: smart search strategy with deduplication (heuristic or LLM-driven)
    let drive: any[] = [];
    const driveQueries: string[] = [];

    // Prefer LLM-proposed queries when available
    if (llmDriveQueries.length) {
      driveQueries.push(...llmDriveQueries);
    }

    const shouldUseHeuristicsForDrive =
      driveQueries.length === 0 || searchStrategy !== QUERY_STRATEGY_LLM_ONLY;

    if (shouldUseHeuristicsForDrive) {
      driveQueries.push(...buildDriveHeuristicQueries(event.title));
    }

    // Remove duplicates and empty queries
    const uniqueDriveQueries = [...new Set(driveQueries.filter(Boolean))];

    // Drive deduplication map: fileId -> file object
    const driveMap = new Map<string, any>();

    // Execute all Drive searches and collect results
    for (const query of uniqueDriveQueries) {
      const driveStartTime = Date.now();
      try {
        const driveResult = await workspaceSearch.searchDrive(query);
        const files = driveResult.files;

        addTimelineEntry("DRIVE_SEARCH", {
          query,
          resultCount: files.length,
          duration: Date.now() - driveStartTime,
        });

        // Store the actual API query (with time filter) in debug data, fall back to original query
        const actualQuery = driveResult.actualQuery || query;
        debugData.searchResults.drive.queries.push(actualQuery);
        debugData.searchResults.drive.totalFound += files.length;

        // Add files to deduplication map
        for (const file of files) {
          if (!driveMap.has(file.id)) {
            driveMap.set(file.id, file);
          }
        }
      } catch (driveError: any) {
        const errorMsg = `Drive search failed for "${query}": ${driveError?.message || "Unknown error"}`;
        if (!debugData.searchResults.drive.errors) {
          debugData.searchResults.drive.errors = [];
        }
        debugData.searchResults.drive.errors.push(errorMsg);

        addTimelineEntry("DRIVE_SEARCH_ERROR", {
          query,
          error: driveError?.message,
          duration: Date.now() - driveStartTime,
        });
      }
    }

    // Convert deduplicated map to array and sort by modification time (most recent first)
    drive = Array.from(driveMap.values()).sort((a, b) => {
      const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
      const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
      return bTime - aTime;
    });

    // Merge in any Drive files attached directly to the calendar event
    if (driveAttachments.length) {
      const seenIds = new Set(
        drive.map((f: any) => (f && typeof f.id === "string" ? f.id : "")),
      );
      const extra = driveAttachments.filter(
        (f: any) => f && typeof f.id === "string" && !seenIds.has(f.id),
      );
      if (extra.length) {
        drive = [...extra, ...drive];
        debugData.searchResults.drive.results = drive;
        debugData.searchResults.drive.included = drive.length;
        debugData.searchResults.drive.totalFound += extra.length;
      }
    }

    // Update debug data with final deduplicated results
    debugData.searchResults.drive.results = drive;
    debugData.searchResults.drive.included = drive.length;

    debugData.summary.apiCalls += uniqueDriveQueries.length;

    // For Gmail: search for emails BETWEEN meeting participants (heuristic or LLM-driven)
    let allGmail: any[] = [];

    if (effectiveAttendees.length > 0 || extractedNames.length > 0) {
      const gmailQueries: string[] = [];
      const gmailTimeframe = `newer_than:${searchTimeframeDays}d`;

      // Prefer LLM-proposed Gmail queries (we append timeframe here)
      if (llmGmailQueries.length) {
        gmailQueries.push(
          ...llmGmailQueries.map((q) => `${q} ${gmailTimeframe}`.trim()),
        );
      }

      const shouldUseHeuristicsForGmail =
        gmailQueries.length === 0 || searchStrategy !== QUERY_STRATEGY_LLM_ONLY;

      if (shouldUseHeuristicsForGmail) {
        const userRecord = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        const currentUserEmail =
          userRecord?.email?.toLowerCase() || session.user.email?.toLowerCase();

        const { queries: heuristicQueries, usedExtractedNames } =
          buildGmailHeuristicQueries({
            effectiveAttendees,
            extractedNames,
            titleQ,
            gmailTimeframe,
            currentUserEmail,
          });

        gmailQueries.push(...heuristicQueries);

        if (usedExtractedNames && extractedNames.length > 0) {
          addTimelineEntry("EXTRACTED_NAME_SEARCH", {
            details: `Searching for extracted names: ${extractedNames.join(", ")}`,
            names: extractedNames,
          });
        }
      }

      // Try each query and collect results
      for (const query of gmailQueries) {
        const gmailStartTime = Date.now();
        try {
          const gmail = await workspaceSearch.searchGmail(query);

          addTimelineEntry("GMAIL_SEARCH", {
            query,
            resultCount: gmail.length,
            duration: Date.now() - gmailStartTime,
          });

          debugData.searchResults.gmail.queries.push(query);
          if (gmail.length > 0) {
            debugData.searchResults.gmail.results.push(...gmail);
            debugData.searchResults.gmail.totalFound += gmail.length;
            debugData.searchResults.gmail.included += gmail.length;

            allGmail = allGmail.concat(...gmail);
          }
        } catch (gmailError: any) {
          const errorMsg = `Gmail search failed for "${query}": ${gmailError?.message || "Unknown error"}`;
          if (!debugData.searchResults.gmail.errors) {
            debugData.searchResults.gmail.errors = [];
          }
          debugData.searchResults.gmail.errors.push(errorMsg);

          addTimelineEntry("GMAIL_SEARCH_ERROR", {
            query,
            error: gmailError?.message,
            duration: Date.now() - gmailStartTime,
          });
        }
      }
      debugData.summary.apiCalls += gmailQueries.length;
    }

    const llmStartTime = Date.now();
    addTimelineEntry("LLM_GENERATION_START", {
      details: "Generating brief from context",
      driveResults: drive.length,
      gmailResults: allGmail.length,
    });

    const brief = await generateBriefFromContext(
      {
        meeting: {
          title: event.title,
          start: event.start,
          attendees: event.attendees,
          description: event.description,
        },
        drive,
        gmail: allGmail,
      },
      {
        systemPromptOverride: briefSystemPromptOverride ?? undefined,
      },
    );

    // Store the actual LLM context from the generation
    debugData.llmContext = brief.llmContext;

    addTimelineEntry("LLM_GENERATION_COMPLETE", {
      duration: Date.now() - llmStartTime,
    });

    const saved = await prisma.brief.create({
      data: {
        meetingId: meeting.id,
        content: brief.content as any,
        confidence: brief.confidence,
        sources: brief.sources as any,
      },
    });

    debugData.summary.briefId = saved.id;
    addTimelineEntry("BRIEF_SAVED", { briefId: saved.id });

    // People: upsert Person rows for attendees, and link to meeting/brief
    const personRows = await upsertPersonsForEmails(
      userId,
      ((event.attendees || []) as { email?: string | null }[]).map(
        (a) => a.email,
      ),
    );
    const personIds = personRows.map((p: any) => p.id);
    await linkMeetingParticipants(meeting.id, personIds);
    await linkBriefParticipants(saved.id, personIds);

    // Create ActionItems from structured response
    const content: any = saved.content as any;
    const items: any[] = Array.isArray(content?.action_items)
      ? content.action_items
      : Array.isArray(content?.suggested_actions)
        ? (content.suggested_actions as string[]).map((s) => ({
            description: s,
          }))
        : [];
    if (items.length) {
      const toCreate = items.slice(0, 20).map((it) => ({
        userId,
        title:
          String(it?.description ?? it?.title ?? "").slice(0, 280) ||
          "Untitled",
        briefId: saved.id,
        status: "open",
        priority: typeof it?.priority === "string" ? it.priority : undefined,
        dueAt:
          it?.due_date && !isNaN(Date.parse(it.due_date))
            ? new Date(it.due_date as string)
            : undefined,
      }));
      await prisma.actionItem.createMany({ data: toCreate });
    }

    // Mark success and calculate final duration
    debugData.summary.success = true;
    debugData.summary.totalDuration = Date.now() - startTime;
    addTimelineEntry("COMPLETE", {
      details: "Brief generation completed successfully",
      totalDuration: debugData.summary.totalDuration,
    });

    // Upload debug data to S3 if enabled
    if (S3DebugStorage.isEnabled()) {
      try {
        const s3Storage = new S3DebugStorage();
        const uploadResult = await s3Storage.uploadDebugData(
          saved.id,
          session.user.id,
          debugData,
        );

        if (uploadResult.success && uploadResult.s3Key) {
          // Update brief with debug metadata
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
          console.log(`Debug data saved to S3 for brief ${saved.id}`);
        }
      } catch (s3Error) {
        console.error("Failed to save debug data to S3:", s3Error);
        // Don't fail the request if debug upload fails
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
    debugData.summary.success = false;
    debugData.summary.error = err?.message || "unknown error";
    debugData.summary.totalDuration = Date.now() - startTime;
    addTimelineEntry("ERROR", {
      error: err?.message || "unknown error",
      stack: err?.stack,
    });

    // Try to save debug data even on error (if we have a briefId)
    if (S3DebugStorage.isEnabled() && debugData.summary.briefId) {
      try {
        const s3Storage = new S3DebugStorage();
        await s3Storage.uploadDebugData(
          debugData.summary.briefId,
          session.user.id,
          debugData,
        );
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
