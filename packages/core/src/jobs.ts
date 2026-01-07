import type { Job, PrismaClient } from "@prisma/client";
import { generateMeetingBriefForEventCore } from "./core/meetingBriefs-core";
import { upsertMeetingFromEventCore } from "./core/meetings-core";
import {
  getUserSettingsCore,
  type UserSettings,
} from "./core/settings-core";
import { getAccessTokenFromAccountCore } from "./core/google-core";
import {
  listEventsByDayWithToken,
  listEventsInRangeWithToken,
  getEventDetailsWithToken,
} from "./google-http";
import { MorningBriefAgent } from "./agents/personas/MorningBriefAgent";
import { generateEndOfDayBriefForUserCore } from "./core/endOfDayBriefs-core";
import { getPrisma } from "./prisma-lambda";
import {
  normalizeIgnorePatterns,
  shouldIgnoreEventByTitle,
  didUserDeclineEvent,
} from "./core/eventFilters-core";
import { sendBriefReadyWebPush } from "./core/webPush-core";
import { safeParseMorningBriefJSON, type MorningBriefJSON } from "@olly/core";
import { flushLangfuse } from "./telemetry/langfuse";

export type JobKind =
  | "MORNING_BRIEF"
  | "EVENING_BRIEF"
  | "MEETING_BRIEF"
  | "CALENDAR_SYNC";

export interface RunJobResult {
  jobId: string;
  status: "DONE" | "FAILED" | "SKIPPED";
  error?: string;
}

export async function runJobById(jobId: string): Promise<RunJobResult> {
  const prisma = await getPrisma();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) {
    return { jobId, status: "SKIPPED", error: "job_not_found" };
  }

  if (job.status !== "PENDING" && job.status !== "QUEUED") {
    return { jobId, status: "SKIPPED", error: "job_not_runnable" };
  }

  let result: RunJobResult;
  try {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: job.attempts + 1 },
    });

    await dispatchJob(prisma, job);

    await prisma.job.update({
      where: { id: job.id },
      data: { status: "DONE", lastError: null },
    });

    result = { jobId: job.id, status: "DONE" };
  } catch (err: any) {
    const message = err?.message || "unknown_error";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message },
    });

    result = { jobId: job.id, status: "FAILED", error: message };
  } finally {
    await flushLangfuse();
  }
  return result;
}

async function dispatchJob(
  prisma: PrismaClient,
  job: Job
): Promise<void> {
  const kind = job.kind as JobKind;
  const payload = (job.payload ?? {}) as any;

  switch (kind) {
    case "MORNING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_morning_brief");
      }
      const dayISO =
        typeof payload.dayISO === "string" ? payload.dayISO : undefined;
      const { briefId } = await generateMorningBriefForUser(
        prisma,
        job.userId,
        dayISO
      );
      if (briefId) {
        sendBriefReadyWebPush(prisma, {
          userId: job.userId,
          briefId,
          kind: "MORNING_BRIEF",
        }).catch((err) => {
          console.error("Failed to send morning brief web push", err);
        });
      }
      return;
    }
    case "MEETING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_meeting_brief");
      }
      const eventId = payload.eventId as string | undefined;
      if (!eventId) {
        throw new Error("missing_eventId_for_meeting_brief");
      }

      const meeting = await prisma.meeting.findUnique({
        where: {
          userId_externalId: {
            userId: job.userId,
            externalId: eventId,
          },
        },
      });
      if (meeting?.status === "ignored" || meeting?.status === "declined") {
        return;
      }

      const settings: UserSettings = await getUserSettingsCore(
        prisma,
        job.userId,
      );
      const ignorePatterns = normalizeIgnorePatterns(settings);
      const searchStrategy =
        (settings.searchStrategy as any as
          | "LLM_ONLY"
          | "HEURISTIC_ONLY"
          | "LLM_AND_HEURISTIC") || "HEURISTIC_ONLY";

      // Pre-flight ignore/decline check with best available data (meeting record + fetched event)
      let title = meeting?.title || null;
      let attendees: any[] =
        (Array.isArray(meeting?.attendees) ? (meeting?.attendees as any[]) : []) ||
        [];
      let fetchedEvent: any = null;

      // Fetch event if we're missing title/attendees or need organizer-derived context
      const account = await prisma.account.findFirst({
        where: { userId: job.userId, provider: "google" },
      });
      if (!account) throw new Error("no_account_for_meeting_brief");
      const token = await getAccessTokenFromAccountCore(prisma, account as any);

      if (!title || attendees.length === 0) {
        fetchedEvent = await getEventDetailsWithToken(token, eventId);
        title = title || fetchedEvent.title || null;
        if (attendees.length === 0 && Array.isArray(fetchedEvent.attendees)) {
          attendees = fetchedEvent.attendees;
        }
      }

      const accountEmail = account.providerAccountId || null;
      const userEmail =
        (await prisma.user.findUnique({
          where: { id: job.userId },
          select: { email: true },
        }))?.email || null;
      const currentUserEmail = userEmail || accountEmail || null;

      if (
        currentUserEmail &&
        didUserDeclineEvent(attendees as any, { currentUserEmail })
      ) {
        const eventData = fetchedEvent || meeting;
        await upsertMeetingFromEventCore(prisma, job.userId, {
          id: eventId,
          title: title || "(no title)",
          start: eventData?.start,
          end: eventData?.end,
          attendees: eventData?.attendees || [],
          description: eventData?.description || null,
          status: "declined",
        });
        return;
      }

      if (
        ignorePatterns.length &&
        title &&
        shouldIgnoreEventByTitle(title, ignorePatterns)
      ) {
        const eventData = fetchedEvent || meeting;
        await upsertMeetingFromEventCore(prisma, job.userId, {
          id: eventId,
          title: title || "(no title)",
          start: eventData?.start,
          end: eventData?.end,
          attendees: eventData?.attendees || [],
          description: eventData?.description || null,
          status: "ignored",
        });
        return;
      }

      const result = await generateMeetingBriefForEventCore(prisma, {
        userId: job.userId,
        eventId,
        searchStrategy,
        userSettings: settings,
        persist: true,
      });
      
      if (result.briefId) {
        sendBriefReadyWebPush(prisma, {
          userId: job.userId,
          briefId: result.briefId,
          kind: "MEETING_BRIEF",
        }).catch((err) => {
          console.error("Failed to send meeting brief web push", err);
        });
      }
      return;
    }
    case "EVENING_BRIEF": {
      if (!job.userId) {
        throw new Error("missing_userId_for_evening_brief");
      }
      const briefTimeInput = payload.briefTime as string | undefined;
      const briefTime = briefTimeInput ? new Date(briefTimeInput) : new Date();
      const windowHours =
        typeof payload.windowHours === "number"
          ? payload.windowHours
          : 24;

      const result = await generateEndOfDayBriefForUserCore(prisma, job.userId, {
        briefTime: Number.isNaN(briefTime.getTime())
          ? new Date()
          : briefTime,
        windowHours,
      });

      if (result.briefId) {
        sendBriefReadyWebPush(prisma, {
          userId: job.userId,
          briefId: result.briefId,
          kind: "EVENING_BRIEF",
        }).catch((err) => {
          console.error("Failed to send evening brief web push", err);
        });
      }
      return;
    }
    case "CALENDAR_SYNC": {
      if (!job.userId) {
        throw new Error("missing_userId_for_calendar_sync");
      }
      const lookaheadHours =
        typeof payload.lookaheadHours === "number"
          ? payload.lookaheadHours
          : 24;
      await syncCalendarForUser(
        prisma,
        job.userId,
        lookaheadHours
      );
      return;
    }
    default:
      throw new Error(`unsupported_job_kind:${job.kind}`);
  }
}

async function generateMorningBriefForUser(
  prisma: PrismaClient,
  userId: string,
  dayISOOverride?: string
): Promise<{ briefId: string }> {
  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";
  const ignorePatterns = normalizeIgnorePatterns(settings);

  const now = new Date();
  const dayISO = dayISOOverride ?? toDayInTimeZone(now, timeZone);

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) {
    throw new Error("no_account");
  }

  const token = await getAccessTokenFromAccountCore(
    prisma,
    account as any,
  );

  const events = await listEventsByDayWithToken(token, dayISO, timeZone);
  const filteredEvents = ignorePatterns.length
    ? events.filter((evt) =>
        shouldIgnoreEventByTitle(evt.title, ignorePatterns) ? false : true,
      )
    : events;

  const meetingsForBrief = filteredEvents.map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.start,
    attendees: event.attendees || [],
    status: (event as any).status || null,
    description: event.description || null,
  }));

  const actionItems = await prisma.actionItem.findMany({
    where: {
      userId,
      status: "open",
      dueAt: {
        gte: new Date(dayISO),
      },
    },
  });

  const actionItemsForBrief = actionItems.map((ai) => ({
    id: ai.id,
    title: ai.title,
    dueAt: ai.dueAt ? ai.dueAt.toISOString() : null,
    status: ai.status as string,
  }));

  const agent = new MorningBriefAgent();
  const rawBrief = await agent.generateMorningBrief(userId, {
    date: dayISO,
    timeZone,
    actionItems: actionItemsForBrief,
  });
  const fullJson = JSON.parse(rawBrief);
  const parsed = safeParseMorningBriefJSON(rawBrief);
  const morning: MorningBriefJSON = parsed ?? {
    brief_markdown: rawBrief,
    highlighted_action_item_ids: [],
  };

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

  const savedBrief = await prisma.brief.create({
    data: {
      meetingId: morningMeeting.id,
      content: {
        brief_markdown: morning.brief_markdown,
        highlighted_action_item_ids: morning.highlighted_action_item_ids,
      },
      confidence: fullJson.sources?.length >= 3 ? "high" : fullJson.sources?.length > 0 ? "medium" : "low",
      sources: fullJson.sources?.map((src: any) => {
        return `${src.type}: ${src.title} -> ${src.url}`;
      }),
    },
  });

  return { briefId: savedBrief ? savedBrief.id : "" };
}

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

async function syncCalendarForUser(
  prisma: PrismaClient,
  userId: string,
  lookaheadHours: number
): Promise<void> {
  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) {
    throw new Error("no_account_for_calendar_sync");
  }

  if (!account.access_token && !account.refresh_token) {
    return;
  }

  const token = await getAccessTokenFromAccountCore(prisma, account as any);

  const now = new Date();
  const timeMin = now;
  const timeMax = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

  let events: Array<{
    id: string;
    title: string;
    start?: string | null;
    end?: string | null;
    attendees?: { email?: string | null }[];
    description?: string | null;
  }> = [];
  try {
    events = await listEventsInRangeWithToken(token, timeMin, timeMax);
  } catch (err: any) {
    return;
  }
  const ignorePatterns = normalizeIgnorePatterns(settings);
  let ignoredCount = 0;

  let upserted = 0;
  for (const event of events) {
    const isIgnored =
      ignorePatterns.length &&
      shouldIgnoreEventByTitle(event.title, ignorePatterns);
    if (isIgnored) ignoredCount += 1;

    await upsertMeetingFromEventCore(prisma, userId, {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
      description: event.description,
      status: isIgnored ? "ignored" : null,
    });
    upserted += 1;
  }
}
