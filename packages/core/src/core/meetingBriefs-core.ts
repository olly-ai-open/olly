import type { PrismaClient } from "@prisma/client";
import {
  getEventDetailsWithToken,
  getDriveFilesByIdsWithToken,
} from "../google-http";
import { WorkspaceSearchCore } from "./workspaceSearch-core";
import {
  buildDriveHeuristicQueries,
  buildGmailHeuristicQueries,
} from "../searchHeuristics";
import { generateBriefFromContext, type BriefJSON } from "../llm";
import { upsertMeetingFromEventCore } from "./meetings-core";
import {
  upsertPersonsForEmailsCore,
  linkMeetingParticipantsCore,
  linkBriefParticipantsCore,
  inferAttendeesFromTitleCore,
} from "./people-core";
import {
  getUserSettingsCore,
  type UserSettings,
} from "./settings-core";
import { getAccessTokenFromAccountCore } from "./google-core";
import type { DebugDataStructure } from "../s3-debug";

export type MeetingBriefSearchStrategy =
  | "LLM_ONLY"
  | "HEURISTIC_ONLY"
  | "LLM_AND_HEURISTIC";

export interface MeetingBriefDebugContext {
  debugData?: DebugDataStructure;
  addTimelineEntry?: (action: string, details?: any) => void;
}

export async function generateMeetingBriefForEventCore(
  prisma: PrismaClient,
  opts: {
    userId: string;
    eventId: string;
    searchStrategy: MeetingBriefSearchStrategy;
    token?: string;
    userSettings?: UserSettings;
    debug?: MeetingBriefDebugContext;
    persist?: boolean;
  },
): Promise<{
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
    settings = await getUserSettingsCore(prisma, userId);
  }
  const searchTimeframeDays = settings.searchTimeframeDays;
  const briefSystemPromptOverride = settings.briefSystemPrompt ?? null;

  let token = tokenOverride;
  if (!token) {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) throw new Error("no_account");
    token = await getAccessTokenFromAccountCore(prisma, account);
  }

  addTimeline("EVENT_LOAD_START", { eventId });
  const event = await getEventDetailsWithToken(token, eventId);
  addTimeline("EVENT_LOAD_COMPLETE", { eventId });

  const workspaceSearch = new WorkspaceSearchCore(prisma, userId);

  const titleQ = event.title?.split(/\s+/).slice(0, 10).join(" ") || "";

  const attendees = ((event.attendees || []) as { email?: string | null }[])
    .map((a) => a.email)
    .filter(Boolean) as string[];

  let inferredAttendees: string[] = [];
  if (!attendees.length && event.title) {
    const inferred = await inferAttendeesFromTitleCore(
      prisma,
      userId,
      event.title,
    );
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

  const driveQueries: string[] = [];
  const gmailQueries: string[] = [];

  const driveTimeframeDays = searchTimeframeDays;
  const gmailTimeframeDays = searchTimeframeDays;

  const driveHeuristicQueries = buildDriveHeuristicQueries(titleQ);
  driveQueries.push(...driveHeuristicQueries);

  const gmailTimeframe = `newer_than:${gmailTimeframeDays}d`;
  const { queries: heuristicQueries } = buildGmailHeuristicQueries({
    effectiveAttendees,
    extractedNames: [],
    titleQ,
    gmailTimeframe,
    currentUserEmail: null,
  });
  gmailQueries.push(...heuristicQueries);

  const drive: any[] = [];
  for (const query of driveQueries) {
    const driveStartTime = Date.now();
    try {
      const { files } = await workspaceSearch.searchDrive(query);
      addTimeline("DRIVE_SEARCH", {
        query,
        resultCount: files.length,
        duration: Date.now() - driveStartTime,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
      }
      if (debugData) {
        debugData.searchResults.drive.queries.push(query);
        debugData.searchResults.drive.totalFound += files.length;
        debugData.searchResults.drive.results.push(
          ...files.slice(0, 5),
        );
      }
      drive.push(...files);
    } catch (err: any) {
      addTimeline("DRIVE_SEARCH_ERROR", {
        query,
        error: err?.message,
        duration: Date.now() - driveStartTime,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
      }
      if (debugData) {
        if (!debugData.searchResults.drive.errors) {
          debugData.searchResults.drive.errors = [];
        }
        debugData.searchResults.drive.errors.push(err?.message || "error");
      }
    }
  }

  let allGmail: any[] = [];
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
        debugData.summary.apiCalls += 1;
      }
      if (debugData) {
        debugData.searchResults.gmail.queries.push(query);
        debugData.searchResults.gmail.totalFound += gmail.length;
        debugData.searchResults.gmail.results.push(
          ...gmail.slice(0, 5),
        );
      }
      allGmail = allGmail.concat(gmail);
    } catch (err: any) {
      addTimeline("GMAIL_SEARCH_ERROR", {
        query,
        error: err?.message,
        duration: Date.now() - gmailStartTime,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
      }
      if (debugData) {
        if (!debugData.searchResults.gmail.errors) {
          debugData.searchResults.gmail.errors = [];
        }
        debugData.searchResults.gmail.errors.push(err?.message || "error");
      }
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
    debugData.summary.apiCalls += 1;
    debugData.llmContext = briefResult.llmContext;
  }

  addTimeline("LLM_GENERATION_COMPLETE", { eventId });

  let meetingId: string | null = null;
  let briefId: string | null = null;

  if (persist) {
    const meeting = await upsertMeetingFromEventCore(prisma, userId, {
      ...event,
      status: "generated",
    });
    meetingId = meeting.id;

    const saved = await prisma.brief.create({
      data: {
        meetingId: meeting.id,
        content: briefResult.content as any,
        confidence: briefResult.confidence,
        sources: briefResult.sources as any,
      },
    });

    const personRows = await upsertPersonsForEmailsCore(
      prisma,
      userId,
      ((event.attendees || []) as { email?: string | null }[]).map(
        (a) => a.email,
      ),
    );
    const personIds = personRows.map((p: any) => p.id);
    await linkMeetingParticipantsCore(prisma, meeting.id, personIds);
    await linkBriefParticipantsCore(prisma, saved.id, personIds);

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
