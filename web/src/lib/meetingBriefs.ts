import { prisma } from "@/lib/prisma";
import {
  getAccessTokenFromAccount,
  getEventDetailsWithToken,
  getDriveFilesByIdsWithToken,
} from "@/lib/google";
import { WorkspaceSearch } from "@/lib/workspaceSearch";
import {
  buildDriveHeuristicQueries,
  buildGmailHeuristicQueries,
} from "@/lib/searchHeuristics";
import { generateBriefFromContext, type BriefJSON } from "@/lib/llm";
import {
  inferAttendeesFromTitle,
  linkBriefParticipants,
  linkMeetingParticipants,
  upsertPersonsForEmails,
} from "@/lib/people";
import { upsertMeetingFromEvent } from "@/lib/meetings";
import { getUserSettings, type UserSettings } from "@/lib/settings";
import type { DebugDataStructure } from "@/lib/s3-debug";

export type MeetingBriefSearchStrategy =
  | "LLM_ONLY"
  | "HEURISTIC_ONLY"
  | "LLM_AND_HEURISTIC";

export interface MeetingBriefDebugContext {
  debugData?: DebugDataStructure;
  addTimelineEntry?: (action: string, details?: any) => void;
}

export async function generateMeetingBriefForEvent(opts: {
  userId: string;
  eventId: string;
  searchStrategy: MeetingBriefSearchStrategy;
  token?: string;
  userSettings?: UserSettings;
  debug?: MeetingBriefDebugContext;
  persist?: boolean;
}): Promise<{
  meetingId: string | null;
  briefId: string | null;
  content: BriefJSON;
}> {
  const {
    userId,
    eventId,
    searchStrategy,
    token: tokenOverride,
    userSettings,
    debug,
    persist = true,
  } = opts as typeof opts & { persist?: boolean };

  const debugData = debug?.debugData;
  const addTimeline =
    debug?.addTimelineEntry ??
    (() => {
      /* noop */
    });

  let settings = userSettings;
  if (!settings) {
    settings = await getUserSettings(userId);
  }
  const searchTimeframeDays = settings.searchTimeframeDays;
  const briefSystemPromptOverride = settings.briefSystemPrompt ?? null;

  let token = tokenOverride;
  if (!token) {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) throw new Error("no_account");
    token = await getAccessTokenFromAccount(account);
  }

  addTimeline("EVENT_LOAD_START", { eventId });
  const event = await getEventDetailsWithToken(token, eventId);
  addTimeline("EVENT_LOAD_COMPLETE", { eventId });

  const workspaceSearch = new WorkspaceSearch(userId);

  const titleQ = event.title?.split(/\s+/).slice(0, 10).join(" ") || "";

  const attendees = ((event.attendees || []) as { email?: string | null }[])
    .map((a) => a.email)
    .filter(Boolean) as string[];

  // Inferred attendees (if no explicit attendees)
  let inferredAttendees: string[] = [];
  if (!attendees.length && event.title) {
    const inferred = await inferAttendeesFromTitle(userId, event.title);
    inferredAttendees = inferred.inferredAttendees;
    if (inferred.inferredAttendees.length) {
      addTimeline("INFERRED_ATTENDEES", {
        eventId,
        namesFromTitle: inferred.namesFromTitle,
        inferredAttendees,
      });
    }
  }

  const effectiveAttendees =
    attendees.length > 0 ? attendees : inferredAttendees;

  // Calendar attachments via Drive
  const rawAttachments = ((event as any)?.raw?.attachments || []) as any[];
  const driveAttachmentIds = rawAttachments
    .map((a: any) => a.fileId)
    .filter(Boolean) as string[];
  let driveAttachments: any[] = [];
  if (driveAttachmentIds.length) {
    addTimeline("CALENDAR_ATTACHMENTS_FETCH_START", {
      count: driveAttachmentIds.length,
    });
    driveAttachments = await getDriveFilesByIdsWithToken(
      token,
      driveAttachmentIds,
    );
    if (driveAttachments.length) {
      addTimeline("CALENDAR_ATTACHMENTS_FETCH_COMPLETE", {
        count: driveAttachments.length,
        fileIds: driveAttachments.map((f: any) => f.id),
      });
    }
  }

  // Drive queries (LLM + heuristics if needed)
  // Note: we can thread LLM query planner in later by calling generateSearchQueriesForEvent here.

  const driveQueries: string[] = [];
  const shouldUseHeuristicsForDrive =
    driveQueries.length === 0 || searchStrategy !== "LLM_ONLY";
  if (shouldUseHeuristicsForDrive) {
    driveQueries.push(...buildDriveHeuristicQueries(event.title));
  }

  const uniqueDriveQueries = [...new Set(driveQueries.filter(Boolean))];

  const driveMap = new Map<string, any>();
  for (const query of uniqueDriveQueries) {
    const driveStartTime = Date.now();
    try {
      const driveResult = await workspaceSearch.searchDrive(query);
      const files = driveResult.files;
      addTimeline("DRIVE_SEARCH", {
        query,
        resultCount: files.length,
        duration: Date.now() - driveStartTime,
      });
      if (debugData) {
        debugData.searchResults.drive.queries.push(
          driveResult.actualQuery || query,
        );
        debugData.searchResults.drive.totalFound += files.length;
      }
      for (const file of files) {
        if (!driveMap.has(file.id)) driveMap.set(file.id, file);
      }
    } catch (err: any) {
      addTimeline("DRIVE_SEARCH_ERROR", {
        query,
        error: err?.message,
        duration: Date.now() - driveStartTime,
      });
      if (debugData) {
        const errorMsg = `Drive search failed for "${query}": ${err?.message || "Unknown error"}`;
        if (!debugData.searchResults.drive.errors) {
          debugData.searchResults.drive.errors = [];
        }
        debugData.searchResults.drive.errors.push(errorMsg);
      }
    }
  }

  let drive = Array.from(driveMap.values()).sort((a, b) => {
    const aTime = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0;
    const bTime = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0;
    return bTime - aTime;
  });

  if (driveAttachments.length) {
    const seenIds = new Set(
      drive.map((f: any) => (f && typeof f.id === "string" ? f.id : "")),
    );
    const extra = driveAttachments.filter(
      (f: any) => f && typeof f.id === "string" && !seenIds.has(f.id),
    );
    if (extra.length) {
      drive = [...extra, ...drive];
      addTimeline("CALENDAR_ATTACHMENTS_MERGED", {
        added: extra.length,
      });
      if (debugData) {
        debugData.searchResults.drive.results = drive;
        debugData.searchResults.drive.included = drive.length;
        debugData.searchResults.drive.totalFound += extra.length;
      }
    }
  }

  if (debugData) {
    debugData.searchResults.drive.results = drive;
    debugData.searchResults.drive.included = drive.length;
    debugData.summary.apiCalls += uniqueDriveQueries.length;
  }

  // Gmail search
  let allGmail: any[] = [];
  if (effectiveAttendees.length || titleQ) {
    const gmailQueries: string[] = [];
    const gmailTimeframe = `newer_than:${searchTimeframeDays}d`;

    const { queries: heuristicQueries, usedExtractedNames } =
      buildGmailHeuristicQueries({
        effectiveAttendees,
        extractedNames: [],
        titleQ,
        gmailTimeframe,
        currentUserEmail: null,
      });

    gmailQueries.push(...heuristicQueries);

    if (usedExtractedNames && debugData) {
      addTimeline("EXTRACTED_NAME_SEARCH", {
        details: "Searching for inferred names in Gmail content",
      });
    }

    for (const query of gmailQueries) {
      const gmailStartTime = Date.now();
      try {
        const gmail = await workspaceSearch.searchGmail(query);
        addTimeline("GMAIL_SEARCH", {
          query,
          resultCount: gmail.length,
          duration: Date.now() - gmailStartTime,
        });
        if (debugData) {
          debugData.searchResults.gmail.queries.push(query);
          if (gmail.length > 0) {
            debugData.searchResults.gmail.results.push(...gmail);
            debugData.searchResults.gmail.totalFound += gmail.length;
            debugData.searchResults.gmail.included += gmail.length;
          }
        }
        allGmail = allGmail.concat(gmail);
      } catch (err: any) {
        addTimeline("GMAIL_SEARCH_ERROR", {
          query,
          error: err?.message,
          duration: Date.now() - gmailStartTime,
        });
        if (debugData) {
          const errorMsg = `Gmail search failed for "${query}": ${err?.message || "Unknown error"}`;
          if (!debugData.searchResults.gmail.errors) {
            debugData.searchResults.gmail.errors = [];
          }
          debugData.searchResults.gmail.errors.push(errorMsg);
        }
      }
    }
    if (debugData) {
      debugData.summary.apiCalls += gmailQueries.length;
    }
  }

  addTimeline("LLM_GENERATION_START", {
    eventId,
    driveResults: drive.length,
    gmailResults: allGmail.length,
  });

  const briefResult = await generateBriefFromContext(
    {
      meeting: {
        title: event.title,
        start: event.start,
        attendees: event.attendees || [],
        description: event.description,
      },
      drive,
      gmail: allGmail,
    },
    {
      systemPromptOverride: briefSystemPromptOverride ?? undefined,
    },
  );

  if (debugData) {
    debugData.llmContext = briefResult.llmContext;
  }

  addTimeline("LLM_GENERATION_COMPLETE", { eventId });

  let meetingId: string | null = null;
  let briefId: string | null = null;

  if (persist) {
    const meeting = await upsertMeetingFromEvent(userId, event);
    meetingId = meeting.id;

    const saved = await prisma.brief.create({
      data: {
        meetingId: meeting.id,
        content: briefResult.content as any,
        confidence: briefResult.confidence,
        sources: briefResult.sources as any,
      },
    });

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

    addTimeline("BRIEF_SAVED", { briefId: saved.id, eventId });

    if (debugData) {
      debugData.summary.briefId = saved.id;
    }

    briefId = saved.id;
  }

  return {
    meetingId,
    briefId,
    content: briefResult.content as BriefJSON,
  };
}
