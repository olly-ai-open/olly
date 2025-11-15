import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAccessTokenFromAccount,
  getEventDetailsWithToken,
  searchDriveSnippets,
  searchGmailMessages,
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
import { S3DebugStorage, type DebugDataStructure } from "@/lib/s3-debug";

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
    const event = await getEventDetailsWithToken(token, eventId);
    const userId = session.user.id;
    const meeting = await upsertMeetingFromEvent(userId, event);

    const titleQ = event.title
      ?.split(/\s+/)
      .slice(0, MAX_PARTICIPANTS)
      .join(" ");
    const attendees = ((event.attendees || []) as { email?: string | null }[])
      .map((a) => a.email)
      .filter(Boolean) as string[];

    // For Drive: smart search strategy
    let drive: any[] = [];
    const driveQueries = [];

    // Strategy 1: Search for the full meeting title if it's specific enough
    if (
      event.title &&
      event.title.length > 8 &&
      !event.title.match(/^(meeting|call|sync|standup|weekly|daily|monthly)$/i)
    ) {
      driveQueries.push(event.title);
    }

    // Strategy 2: Search for meaningful multi-word phrases from title
    if (event.title) {
      const meaningfulPhrases = [];
      const words = event.title.split(/[\s\-\/]+/).filter((w) => w.length > 2);

      // Look for multi-word phrases that might be project/product names
      for (let i = 0; i < words.length - 1; i++) {
        const phrase = words.slice(i, i + 2).join(" ");
        // Skip generic phrases
        if (
          !phrase.match(
            /^(weekly|daily|monthly|meeting|call|sync|standup|check|in)\s/i,
          ) &&
          !phrase.match(
            /\s(weekly|daily|monthly|meeting|call|sync|standup|check|in)$/i,
          )
        ) {
          meaningfulPhrases.push(phrase);
        }
      }
      driveQueries.push(...meaningfulPhrases);
    }

    // Strategy 3: If it's a recurring meeting, search for the base name without frequency indicators
    if (event.title) {
      const baseTitle = event.title
        .replace(
          /\s*-\s*(weekly|daily|monthly|biweekly|standup|sync|meeting|call)\s*/gi,
          "",
        )
        .replace(
          /\s*(weekly|daily|monthly|biweekly|standup|sync|meeting|call)\s*/gi,
          "",
        )
        .trim();
      if (baseTitle && baseTitle !== event.title && baseTitle.length > 5) {
        driveQueries.push(baseTitle);
      }
    }

    // Remove duplicates and empty queries
    const uniqueDriveQueries = [...new Set(driveQueries.filter(Boolean))];

    // Try each query until we get results
    for (const query of uniqueDriveQueries) {
      const driveStartTime = Date.now();
      try {
        const driveResult = await searchDriveSnippets(userId, query);
        drive = driveResult.files;

        addTimelineEntry("DRIVE_SEARCH", {
          query,
          resultCount: drive.length,
          duration: Date.now() - driveStartTime,
        });

        // Store the actual API query (with time filter) in debug data, fall back to original query
        const actualQuery = driveResult.actualQuery || query;
        debugData.searchResults.drive.queries.push(actualQuery);
        if (drive.length > 0) {
          debugData.searchResults.drive.results.push(...drive);
          debugData.searchResults.drive.totalFound += drive.length;
          debugData.searchResults.drive.included += drive.length;
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

    debugData.summary.apiCalls += uniqueDriveQueries.length;

    // For Gmail: search for emails BETWEEN meeting participants
    let allGmail: any[] = [];
    if (attendees.length > 0) {
      const gmailQueries = [];

      // Build queries for emails between participants
      if (attendees.length >= 2) {
        // For each participant, find emails they sent TO other participants
        for (const fromEmail of attendees.slice(0, 3)) {
          const otherAttendees = attendees.filter(
            (email) => email !== fromEmail,
          );
          if (otherAttendees.length > 0) {
            const toQuery = otherAttendees
              .slice(0, 3)
              .map((email) => `to:${email}`)
              .join(" OR ");
            gmailQueries.push(`from:${fromEmail} (${toQuery}) newer_than:30d`);

            // Also try with subject if available
            if (titleQ) {
              gmailQueries.push(
                `from:${fromEmail} (${toQuery}) subject:"${titleQ}" newer_than:30d`,
              );
            }
          }
        }

        // Fallback: emails containing multiple participant addresses in any field
        const participantQuery = attendees
          .slice(0, 3)
          .map((email) => `"${email}"`)
          .join(" AND ");
        gmailQueries.push(`(${participantQuery}) newer_than:30d`);
      } else {
        // Single participant fallback (shouldn't happen in meetings, but just in case)
        gmailQueries.push(`from:${attendees[0]} newer_than:30d`);
      }

      // Try broader search with title if nothing else works
      if (titleQ) {
        gmailQueries.push(`"${titleQ}" newer_than:30d`);
      }

      // Try each query until we get results
      for (const query of gmailQueries) {
        const gmailStartTime = Date.now();
        let gmail: any[] = [];
        try {
          gmail = await searchGmailMessages(userId, query);

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

    const brief = await generateBriefFromContext({
      meeting: {
        title: event.title,
        start: event.start,
        attendees: event.attendees,
        description: event.description,
      },
      drive,
      gmail: allGmail,
    });

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
