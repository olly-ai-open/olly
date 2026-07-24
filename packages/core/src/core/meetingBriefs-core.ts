import type { PrismaClient } from "@prisma/client";
import { getEventDetailsWithToken } from "../google-http";
import { type BriefJSON, safeParseBriefJSON } from "../llm";
import { upsertMeetingFromEventCore } from "./meetings-core";
import {
  upsertPersonsForEmailsCore,
  linkMeetingParticipantsCore,
  linkBriefParticipantsCore,
} from "./people-core";
import {
  getUserSettingsCore,
  type UserSettings,
} from "./settings-core";
import { getAccessTokenFromAccountCore } from "./google-core";
import {
  normalizeIgnorePatterns,
  shouldIgnoreEventByTitle,
  didUserDeclineEvent,
} from "./eventFilters-core";
import { MeetingPrepAgent } from "../agents/personas/MeetingPrepAgent";

export async function generateMeetingBriefForEventCore(
  prisma: PrismaClient,
  opts: {
    userId: string;
    eventId: string;
    token?: string;
    userSettings?: UserSettings;
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
    token: tokenOverride,
    userSettings,
    persist = true,
    force = false,
  } = opts as typeof opts & { persist?: boolean; force?: boolean };

  let settings = userSettings;
  if (!settings) {
    settings = await getUserSettingsCore(userId);
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

  const event = await getEventDetailsWithToken(token, eventId);

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
  if (userDeclined && !force) {
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
  }
  if (matchesIgnorePattern && !force) {
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

  const briefResult: {
    content: BriefJSON;
    confidence: string;
    sources: any[];
    llmContext?: any;
  } = {
    content: { brief_markdown: "" } as BriefJSON,
    confidence: "low",
    sources: [],
  };

  const agent = new MeetingPrepAgent({
    systemPrompt: briefSystemPromptOverride || undefined,
    telemetryEnabled: settings.telemetryOptIn !== false,
  });
  const agentBrief = await agent.prepareMeetingBrief(eventId, userId, {
    token,
    searchTimeframeDays,
    timeZone: settings.timeZone ?? undefined,
  });
  const parsed = safeParseBriefJSON(agentBrief);
  briefResult.content = parsed ?? {
    brief_markdown: agentBrief,
    goals: [],
    key_context: [],
  };
  const sources = (parsed as any)?.sources;
  briefResult.confidence =
    Array.isArray(sources) && sources.length >= 3
      ? "high"
      : Array.isArray(sources) && sources.length > 0
        ? "medium"
        : "low";
  briefResult.sources = Array.isArray(sources)
    ? sources.map((src: any) => `${src.type}: ${src.title} -> ${src.url}`)
    : [];

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

    briefId = saved.id;
  }

  return {
    meetingId,
    briefId,
    content: briefResult.content as BriefJSON,
  };
}