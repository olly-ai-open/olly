import type { PrismaClient } from "@prisma/client";
import { getEventDetailsWithToken } from "../google-http";
import {
  buildDriveHeuristicQueries,
  buildGmailHeuristicQueries,
  buildSlackHeuristicQueries,
} from "../searchHeuristics";
import { generateBriefFromContext, type BriefJSON, safeParseBriefJSON } from "../llm";
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
  didUserDeclineEvent,
} from "./eventFilters-core";
import { MeetingPrepAgent } from "../agents/personas/MeetingPrepAgent";

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
  | "LLM_AND_HEURISTIC"
  | "AGENT";

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
    force?: boolean;
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
    force = false,
  } = opts as typeof opts & { persist?: boolean; force?: boolean };

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

  const currentUserEmail =
    (
      await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      })
    )?.email ?? null;

  const userDeclined = didUserDeclineEvent(event.attendees as any, {
    currentUserEmail,
  });
  if (userDeclined && force) {
    addTimeline("EVENT_DECLINED_OVERRIDDEN", { eventId });
  }
  if (userDeclined && !force) {
    addTimeline("EVENT_DECLINED", { eventId });

    let meetingId: string | null = null;
    if (persist) {
      const meeting = await upsertMeetingFromEventCore(prisma, userId, {
        id: event.id,
        title: event.title || "(no title)",
        start: event.start,
        end: event.end,
        attendees: event.attendees || [],
        description: event.description || null,
        status: "declined",
      });
      meetingId = meeting.id;
    }

    return {
      meetingId,
      briefId: null,
      content: { brief_markdown: "" },
    };
  }

  const matchesIgnorePattern =
    ignorePatterns.length &&
    shouldIgnoreEventByTitle(event.title, ignorePatterns);
  if (matchesIgnorePattern && force) {
    addTimeline("EVENT_IGNORED_BY_PATTERN_OVERRIDDEN", {
      eventId,
      title: event.title,
    });
  }
  if (matchesIgnorePattern && !force) {
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

  let briefResult: {
    content: BriefJSON;
    confidence: string;
    sources: any[];
    llmContext?: any;
  };

  // Use agent-based generation if specified
  if (searchStrategy === "AGENT") {
    addTimeline("AGENT_GENERATION_START", { eventId });
    
    // Create the agent with the user's custom prompt if provided
    const agent = new MeetingPrepAgent({
      systemPrompt: briefSystemPromptOverride || undefined,
    });

    try {
      // Prepare the meeting brief using the agent
      const agentBrief = await agent.prepareMeetingBrief(
        eventId,
        userId,
        {
          token,
          debugContext: debug,
          searchTimeframeDays,
        }
      );
      const fullJson = JSON.parse(agentBrief);
      const parsed = safeParseBriefJSON(agentBrief);
      const content: BriefJSON = parsed ?? {
        brief_markdown: agentBrief,
        goals: [],
        key_context: [],
      };
      briefResult = {
        content,
        confidence: fullJson.sources?.length >= 3 ? "high" : fullJson.sources?.length > 0 ? "medium" : "low",
        sources: fullJson.sources?.map((src: any) => {
          return `${src.type}: ${src.title} -> ${src.url}`;
        })
      };

      if (debugData) {
        debugData.summary.apiCalls += 1;
        // Add agent-specific debug info
        (debugData as any).agentContext = {
          strategy: "AGENT",
          agentUsed: "MeetingPrepAgent",
        };
      }

      addTimeline("AGENT_GENERATION_COMPLETE", { eventId });
    } catch (agentError: any) {
      addTimeline("AGENT_GENERATION_FAILED", { 
        eventId, 
        error: agentError.message 
      });
      
      // Fall back to LLM_AND_HEURISTIC strategy
      console.error("Agent generation failed, falling back to LLM_AND_HEURISTIC:", agentError);
      
      // Continue with regular heuristic + LLM flow below
      // by not returning and letting the code fall through
    }
  }
  
  // Use heuristic-based generation if not using agent or agent failed
  if (searchStrategy !== "AGENT" || !briefResult!) {
    const driveQueries: string[] = [];
    const gmailQueries: string[] = [];
    const slackQueries: string[] = [];

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

    const slackHeuristicQueries = buildSlackHeuristicQueries({
      titleQ,
      attendees: effectiveAttendees,
    });
    slackQueries.push(...slackHeuristicQueries);

    const drive: any[] = [];
    const {
      drive: driveRes,
      gmail: gmailRes,
      slack: slackRes,
    } = await runWorkspaceQueryPlan(
      prisma,
      userId,
      { driveQueries, gmailQueries, slackQueries },
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
    const slackMessages = slackRes
      .filter((m: any) => typeof m?.text === "string" && m.text.trim().length)
      .map((m: any) => ({
        ...m,
        text: (m.text as string).trim(),
      }));

    addTimeline("LLM_GENERATION_START", {
      eventId,
      driveResults: drive.length,
      gmailResults: allGmail.length,
      slackResults: slackMessages.length,
    });

    briefResult = await generateBriefFromContext(
      {
        meeting: {
          title: event.title,
          start: event.start,
          attendees: event.attendees || [],
          description: event.description,
        },
        drive,
        gmail: allGmail,
        slack: slackMessages,
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
  }

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
