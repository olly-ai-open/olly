import type { PrismaClient } from "@prisma/client";
import { getEventDetailsWithToken } from "../google-http";
import {
  buildDriveHeuristicQueries,
  buildGmailHeuristicQueries,
} from "../searchHeuristics";
import { generateBriefFromContext, type BriefJSON } from "../llm";
import { runWorkspaceQueryPlan } from "./briefQueries-core";
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
import {
  normalizeIgnorePatterns,
  shouldIgnoreEventByTitle,
} from "./eventFilters-core";

function getHeaderValue(headers: any[], name: string): string | null {
  const h = headers.find(
    (hh: any) => typeof hh?.name === "string" && hh.name.toLowerCase() === name,
  );
  return typeof h?.value === "string" && h.value.trim().length
    ? h.value.trim()
    : null;
}

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
  const ignorePatterns = normalizeIgnorePatterns(settings);

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

  if (
    ignorePatterns.length &&
    shouldIgnoreEventByTitle(event.title, ignorePatterns)
  ) {
    addTimeline("EVENT_IGNORED_BY_PATTERN", {
      eventId,
      title: event.title,
    });

    let meetingId: string | null = null;
    if (persist) {
      const existingMeeting = await prisma.meeting.findUnique({
        where: {
          userId_externalId: {
            userId,
            externalId: eventId,
          },
        },
      });

      if (existingMeeting?.status === "generated") {
        meetingId = existingMeeting.id;
      } else {
        const meeting = await upsertMeetingFromEventCore(prisma, userId, {
          id: event.id,
          title: event.title || "(no title)",
          start: event.start,
          end: event.end,
          attendees: event.attendees || [],
          description: event.description || null,
          status: "ignored",
        });
        meetingId = meeting.id;
      }
    }

    return {
      meetingId,
      briefId: null,
      content: { brief_markdown: "" },
    };
  }

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

  const driveQueries: string[] = [];
  const gmailQueries: string[] = [];

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
  const { drive: driveRes, gmail: gmailRes } = await runWorkspaceQueryPlan(
    prisma,
    userId,
    { driveQueries, gmailQueries },
    { debugData, addTimelineEntry: addTimeline },
  );
  drive.push(...driveRes);
  const allGmail = gmailRes.map((m: any) => {
    const headers = Array.isArray(m.payload?.headers) ? m.payload.headers : [];
    return {
      ...m,
      subject: getHeaderValue(headers, "subject") || m.snippet || "(no subject)",
      from: getHeaderValue(headers, "from") || "",
      to: getHeaderValue(headers, "to") || "",
      snippet: m.snippet || "",
      body: m.text || "",
    };
  });

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
