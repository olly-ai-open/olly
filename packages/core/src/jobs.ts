import type { Job, PrismaClient } from "@prisma/client";
import { generateMeetingBriefForEventCore } from "./core/meetingBriefs-core";
import { upsertMeetingFromEventCore } from "./core/meetings-core";
import {
  getUserSettingsCore,
  type UserSettings,
} from "./core/settings-core";
import { getAccessTokenFromAccountCore } from "./core/google-core";
import { listEventsByDayWithToken, listEventsInRangeWithToken } from "./google-http";
import { generateMorningBrief } from "./llm";
import { getPrisma } from "./prisma-lambda";
import { S3DebugStorage, type DebugDataStructure } from "./s3-debug";

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

  const debugCtx = S3DebugStorage.isEnabled()
    ? createDebugContext(job.userId || "")
    : null;
  const startedAt = Date.now();

  try {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: job.attempts + 1 },
    });

    await dispatchJob(prisma, job, debugCtx ?? undefined);

    await prisma.job.update({
      where: { id: job.id },
      data: { status: "DONE", lastError: null },
    });

    return { jobId: job.id, status: "DONE" };
  } catch (err: any) {
    const message = err?.message || "unknown_error";
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message },
    });

    if (debugCtx) {
      markDebugFailure(debugCtx.debugData, startedAt, message);
      const targetId =
        debugCtx.debugData.summary.briefId || job.id || "unknown";
      debugCtx.debugData.summary.briefId =
        debugCtx.debugData.summary.briefId || targetId;
      await uploadDebugData(
        prisma,
        targetId,
        job.userId || "",
        debugCtx.debugData,
        false,
      ).catch((e) => {
        console.error("Failed to upload debug data on job failure", e);
      });
    }
    return { jobId: job.id, status: "FAILED", error: message };
  }
}

async function dispatchJob(
  prisma: PrismaClient,
  job: Job,
  debugCtx?: {
    debugData: DebugDataStructure;
    addTimelineEntry: (action: string, details?: any) => void;
  },
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
      const start = Date.now();
      const { briefId } = await generateMorningBriefForUser(
        prisma,
        job.userId,
        dayISO,
        debugCtx ?? undefined,
      );
      if (debugCtx && briefId) {
        if (!debugCtx.debugData.summary.totalDuration) {
          markDebugSuccess(debugCtx.debugData, briefId, start);
        }
        await uploadDebugData(prisma, briefId, job.userId, debugCtx.debugData);
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

      const settings: UserSettings = await getUserSettingsCore(
        prisma,
        job.userId,
      );
      const searchStrategy =
        (settings.searchStrategy as any as
          | "LLM_ONLY"
          | "HEURISTIC_ONLY"
          | "LLM_AND_HEURISTIC") || "HEURISTIC_ONLY";

      const start = Date.now();
      const result = await generateMeetingBriefForEventCore(prisma, {
        userId: job.userId,
        eventId,
        searchStrategy,
        userSettings: settings,
        persist: true,
        debug: debugCtx
          ? {
              debugData: debugCtx.debugData,
              addTimelineEntry: debugCtx.addTimelineEntry,
            }
          : undefined,
      });
      if (debugCtx && result.briefId) {
        debugCtx.debugData.summary.briefId = result.briefId;
        debugCtx.debugData.summary.userId = job.userId;
        markDebugSuccess(debugCtx.debugData, result.briefId, start);
        await uploadDebugData(
          prisma,
          result.briefId,
          job.userId,
          debugCtx.debugData,
        );
      } else if (debugCtx && debugCtx.debugData.summary.briefId) {
        markDebugSuccess(
          debugCtx.debugData,
          debugCtx.debugData.summary.briefId,
          start,
        );
        await uploadDebugData(
          prisma,
          debugCtx.debugData.summary.briefId,
          job.userId,
          debugCtx.debugData,
        );
      }
      return;
    }
    case "EVENING_BRIEF": {
      // Placeholder for future implementation.
      // For now, mark as no-op.
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
        lookaheadHours,
        debugCtx ?? undefined,
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
  dayISOOverride?: string,
  debugCtx?: {
    debugData: DebugDataStructure;
    addTimelineEntry: (action: string, details?: any) => void;
  },
): Promise<{ briefId: string }> {
  const addTimeline = debugCtx?.addTimelineEntry ?? (() => {});
  const debugData = debugCtx?.debugData;
  const start = Date.now();

  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";

  const now = new Date();
  const dayISO = dayISOOverride ?? toDayInTimeZone(now, timeZone);

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) {
    throw new Error("no_account");
  }

  addTimeline("ACCOUNT_FOUND", { userId, provider: "google" });

  const token = await getAccessTokenFromAccountCore(
    prisma,
    account as any,
  );
  addTimeline("ACCESS_TOKEN_RETRIEVED");

  const events = await listEventsByDayWithToken(token, dayISO, timeZone);
  if (debugData) {
    debugData.summary.apiCalls += 1;
  }
  addTimeline("CAL_EVENTS_FETCHED", { count: events.length, dayISO });

  const meetingsForBrief = events.map((event) => ({
    id: event.id,
    title: event.title,
    startsAt: event.start,
    attendees: event.attendees || [],
    status: (event as any).status || null,
    description: event.description || null,
  }));
  if (debugData) {
    debugData.searchResults.drive.queries.push("calendar:events");
    debugData.searchResults.drive.totalFound += 0;
    debugData.searchResults.gmail.queries.push("calendar:events");
    debugData.searchResults.gmail.totalFound += 0;
    addTimeline("CAL_EVENTS_CAPTURED", {
      count: meetingsForBrief.length,
    });
  }

  const actionItems = await prisma.actionItem.findMany({
    where: {
      userId,
      status: "open",
      dueAt: {
        gte: new Date(dayISO),
      },
    },
  });
  if (debugData) {
    debugData.summary.apiCalls += 1;
  }

  const actionItemsForBrief = actionItems.map((ai) => ({
    id: ai.id,
    title: ai.title,
    dueAt: ai.dueAt ? ai.dueAt.toISOString() : null,
    status: ai.status as string,
  }));
  if (debugData) {
    addTimeline("ACTION_ITEMS_FETCHED", { count: actionItemsForBrief.length });
  }

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
  if (debugData) {
    debugData.llmContext = morning.llmContext;
    debugData.searchResults.drive.included =
      debugData.searchResults.drive.results.length;
    debugData.searchResults.gmail.included =
      debugData.searchResults.gmail.results.length;
    debugData.summary.apiCalls += 1;
  }
  addTimeline("LLM_MORNING_BRIEF_COMPLETE");

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
        highlighted_action_item_ids: morning.highlightedActionItemIds,
      } as any,
    },
  });

  if (debugData && savedBrief) {
    debugData.summary.briefId = savedBrief.id;
    debugData.summary.userId = userId;
    debugData.summary.success = true;
    debugData.summary.totalDuration = Date.now() - start;
    addTimeline("MORNING_BRIEF_SAVED", { briefId: savedBrief.id });
    addTimeline("COMPLETE", {
      totalDuration: debugData.summary.totalDuration,
    });
  }

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

function createDebugContext(userId: string): {
  debugData: DebugDataStructure;
  addTimelineEntry: (action: string, details?: any) => void;
} {
  const startedAt = Date.now();
  const debugData: DebugDataStructure = {
    version: "1.0",
    summary: {
      briefId: "",
      userId,
      timestamp: new Date().toISOString(),
      totalDuration: 0,
      apiCalls: 0,
      success: false,
    },
    timeline: [
      {
        action: 'START',
        duration: 0,
        timestamp: startedAt,
      }
    ],
    searchResults: {
      drive: { queries: [], totalFound: 0, included: 0, results: [] },
      gmail: { queries: [], totalFound: 0, included: 0, results: [] },
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
      timestamp: Date.now() - startedAt,
      action,
      ...details,
    });
  };

  return { debugData, addTimelineEntry };
}

async function uploadDebugData(
  prisma: PrismaClient,
  briefId: string,
  userId: string,
  debugData: DebugDataStructure,
  updateBriefMeta = true,
) {
  if (!S3DebugStorage.isEnabled()) return;
  const s3Storage = new S3DebugStorage();
  const uploadResult = await s3Storage.uploadDebugData(
    briefId,
    userId,
    debugData,
  );

  if (uploadResult.success && uploadResult.s3Key && updateBriefMeta) {
    await prisma.brief.update({
      where: { id: briefId },
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
  }
}

function markDebugSuccess(
  debugData: DebugDataStructure,
  briefId: string,
  startMs: number,
) {
  debugData.summary.briefId = briefId;
  debugData.summary.success = true;
  debugData.summary.totalDuration = Date.now() - startMs;
  debugData.timeline.push({
    timestamp: debugData.summary.totalDuration,
    action: "COMPLETE",
    duration: debugData.summary.totalDuration,
  });
}

function markDebugFailure(
  debugData: DebugDataStructure,
  startMs: number,
  error: string,
) {
  debugData.summary.success = false;
  debugData.summary.error = error;
  debugData.summary.totalDuration = Date.now() - startMs;
  debugData.timeline.push({
    timestamp: debugData.summary.totalDuration,
    action: "ERROR",
    duration: debugData.summary.totalDuration,
    error,
  });
}

async function syncCalendarForUser(
  prisma: PrismaClient,
  userId: string,
  lookaheadHours: number,
  debugCtx?: {
    debugData: DebugDataStructure;
    addTimelineEntry: (action: string, details?: any) => void;
  },
): Promise<void> {
  const addTimeline = debugCtx?.addTimelineEntry ?? (() => {});
  const debugData = debugCtx?.debugData;
  const start = Date.now();

  const settings = await getUserSettingsCore(prisma, userId);
  const timeZone = settings.timeZone || "UTC";

  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) {
    throw new Error("no_account_for_calendar_sync");
  }

  addTimeline("SYNC_ACCOUNT_FOUND", { userId, provider: "google" });

  const token = await getAccessTokenFromAccountCore(prisma, account as any);
  addTimeline("SYNC_ACCESS_TOKEN_RETRIEVED");

  const now = new Date();
  const timeMin = now;
  const timeMax = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);

  const events = await listEventsInRangeWithToken(token, timeMin, timeMax);
  addTimeline("SYNC_EVENTS_FETCHED", {
    count: events.length,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  });
  if (debugData) {
    debugData.summary.apiCalls += 1;
  }

  let upserted = 0;
  for (const event of events) {
    await upsertMeetingFromEventCore(prisma, userId, {
      id: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      attendees: event.attendees,
      description: event.description,
    });
    upserted += 1;
  }

  addTimeline("SYNC_MEETINGS_UPSERTED", { count: upserted });

  if (debugData) {
    debugData.summary.totalDuration = Date.now() - start;
  }
}
