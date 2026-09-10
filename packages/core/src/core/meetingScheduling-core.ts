/**
 * Orchestration for Olly-arranged meetings ("find a time with a, b and c").
 *
 * Olly emails attendees from the user's own Gmail, tracks the thread by the
 * Gmail threadId plus a reference token in the subject, parses replies with
 * the SchedulingAgent, and books the calendar event once every required
 * attendee has accepted a slot. Deterministic decisions live in
 * availability-core; LLM calls live in agents/personas/SchedulingAgent.
 */

import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  computeCandidateSlots,
  decideNextNegotiationStep,
  mergeBusyIntervals,
  pickProposalSlots,
  type AttendeeNegotiationState,
  type BusyInterval,
  type SchedulingConstraints,
  type SchedulingPreferences,
  type TimeSlot,
} from "./availability-core";
import {
  draftSchedulingEmailBody,
  formatSlotForEmail,
  parseSchedulingReply,
} from "../agents/personas/SchedulingAgent";
import { getAccessTokenFromAccountCore } from "./google-core";
import { getUserSettingsCore } from "./settings-core";
import { upsertPersonsForEmailsCore } from "./people-core";
import {
  createCalendarEventWithToken,
  extractPlainTextFromGmailMessage,
  getGmailThreadWithToken,
  listEventsInRangeWithToken,
  queryFreeBusyWithToken,
  searchGmailMessagesWithToken,
  sendGmailMessageWithToken,
} from "../google-http";

export const SCHEDULING_MAX_ROUNDS = 5;
const PROPOSALS_PER_ROUND = 3;
const CANDIDATE_POOL_SIZE = 24;

export type SchedulingRequestStatus =
  | "DRAFT"
  | "AWAITING_REPLIES"
  | "NEGOTIATING"
  | "AWAITING_APPROVAL"
  | "READY_TO_BOOK"
  | "BOOKED"
  | "NEEDS_ATTENTION"
  | "CANCELLED";

export interface CreateSchedulingRequestInput {
  title: string;
  durationMinutes: number;
  constraints: SchedulingConstraints;
  attendees: Array<{ email: string; name?: string | null; required: boolean }>;
  autoBook: boolean;
  /** Proceed autonomously with counter-proposed times inside the date window. */
  autoAltTimes?: boolean;
  /** Proceed autonomously with counter-proposed times outside the date window. */
  autoAltDates?: boolean;
}

/** An attendee-suggested slot, tracked with who proposed it. */
export type SuggestedSlot = TimeSlot & {
  suggestedBy: string;
  calendarStatus?: "free" | "busy" | "unknown";
  conflictTitle?: string | null;
};

type OwnerBusyEvent = { start: number; end: number; title: string };

type OwnerBusy = {
  busy: BusyInterval[];
  events: OwnerBusyEvent[];
};

function eventMs(value: string | null): number {
  if (!value) return NaN;
  // All-day dates are YYYY-MM-DD; treat as UTC midnight so Date.parse works.
  return Date.parse(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

function conflictTitleFor(
  events: OwnerBusyEvent[],
  start: number,
  end: number,
): string | null {
  for (const e of events) {
    if (e.start < end && e.end > start) return e.title;
  }
  return null;
}

/**
 * Owner's real busy picture: free/busy on `primary` + the account email,
 * plus primary events (so a miss on free/busy still blocks occupied slots
 * and we can name the conflicting meeting on the approval card).
 */
async function loadOwnerBusy(
  token: string,
  userEmail: string,
  timeMin: Date,
  timeMax: Date,
): Promise<OwnerBusy> {
  const [freeBusy, events] = await Promise.all([
    queryFreeBusyWithToken(token, ["primary", userEmail], timeMin, timeMax),
    listEventsInRangeWithToken(token, timeMin, timeMax),
  ]);

  const ownerCalendars = freeBusy.filter(
    (c) => c.email === "primary" || c.email.toLowerCase() === userEmail.toLowerCase(),
  );
  const fromFb: BusyInterval[] = ownerCalendars.flatMap((c) => c.busy);
  const fromEvents: OwnerBusyEvent[] = events
    .filter(
      (e) =>
        e.status !== "cancelled" &&
        (e as { transparency?: string }).transparency !== "transparent",
    )
    .map((e) => ({
      start: eventMs(e.start),
      end: eventMs(e.end),
      title: e.title,
    }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start);

  const busy: BusyInterval[] = [
    ...fromFb,
    ...fromEvents.map((e) => ({
      start: new Date(e.start).toISOString(),
      end: new Date(e.end).toISOString(),
    })),
  ];

  const fbFailed = ownerCalendars.every(
    (c) => (c.errors?.length ?? 0) > 0 && c.busy.length === 0,
  );
  if (fbFailed && fromEvents.length === 0) {
    throw new Error("owner_calendar_unavailable");
  }

  return { busy, events: fromEvents };
}

function newReferenceToken(): string {
  return randomBytes(4).toString("hex");
}

function subjectFor(title: string, referenceToken: string): string {
  return `Finding a time: ${title} [Olly#${referenceToken}]`;
}

async function getGoogleContext(prisma: PrismaClient, userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    orderBy: { expires_at: "desc" },
  });
  if (!account) throw new Error("google_not_connected");
  const token = await getAccessTokenFromAccountCore(prisma, account as any);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  const userEmail = user?.email || account.providerAccountId || null;
  if (!userEmail) throw new Error("user_email_unknown");
  return {
    token,
    userEmail: userEmail.toLowerCase(),
    userName: user?.name || userEmail.split("@")[0],
  };
}

function preferencesFromSettings(settings: {
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  workingDays: number[];
  meetingBufferMinutes: number;
  minSchedulingNoticeHours: number;
}): SchedulingPreferences {
  return {
    workingHoursStart: settings.workingHoursStart,
    workingHoursEnd: settings.workingHoursEnd,
    workingDays: settings.workingDays,
    meetingBufferMinutes: settings.meetingBufferMinutes,
    minSchedulingNoticeHours: settings.minSchedulingNoticeHours,
  };
}

export async function createSchedulingRequestCore(
  prisma: PrismaClient,
  userId: string,
  input: CreateSchedulingRequestInput,
) {
  const emails = input.attendees.map((a) => a.email.trim().toLowerCase());
  const persons = await upsertPersonsForEmailsCore(prisma, userId, emails);
  const personByEmail = new Map(
    (persons as any[]).map((p) => [(p.email || "").toLowerCase(), p.id]),
  );

  const request = await prisma.schedulingRequest.create({
    data: {
      userId,
      title: input.title,
      durationMinutes: input.durationMinutes,
      status: "DRAFT",
      constraints: input.constraints as any,
      referenceToken: newReferenceToken(),
      autoBook: input.autoBook,
      autoAltTimes: input.autoAltTimes !== false,
      autoAltDates: input.autoAltDates === true,
      attendees: {
        create: input.attendees.map((a) => ({
          email: a.email.trim().toLowerCase(),
          name: a.name || null,
          required: a.required,
          personId: personByEmail.get(a.email.trim().toLowerCase()) || null,
        })),
      },
    },
    include: { attendees: true },
  });

  return request;
}

/**
 * Send round 1: free/busy over the request window (user + any attendee whose
 * calendar is visible), compute candidates, email proposals to everyone.
 */
export async function startSchedulingRequestCore(
  prisma: PrismaClient,
  requestId: string,
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { attendees: true },
  });
  if (!request) throw new Error("scheduling_request_not_found");
  if (request.status !== "DRAFT") {
    throw new Error(`scheduling_request_not_startable:${request.status}`);
  }

  const { token, userEmail, userName } = await getGoogleContext(
    prisma,
    request.userId,
  );
  const settings = await getUserSettingsCore(request.userId);
  const timeZone = settings.timeZone || "UTC";
  const constraints = request.constraints as unknown as SchedulingConstraints;

  const attendeeEmails = request.attendees.map((a) => a.email);
  const windowStart = new Date(constraints.windowStartISO);
  const windowEnd = new Date(constraints.windowEndISO);
  const ownerBusy = await loadOwnerBusy(token, userEmail, windowStart, windowEnd);
  const attendeeBusy = attendeeEmails.length
    ? await queryFreeBusyWithToken(token, attendeeEmails, windowStart, windowEnd)
    : [];
  // Attendees with hidden calendars contribute no busy blocks; the email
  // negotiation covers them. The owner's primary calendar is always required.
  const busy: BusyInterval[] = [
    ...ownerBusy.busy,
    ...attendeeBusy.flatMap((c) => c.busy),
  ];

  const candidates = computeCandidateSlots({
    busy,
    constraints,
    preferences: preferencesFromSettings(settings),
    durationMinutes: request.durationMinutes,
    timeZone,
    maxSlots: CANDIDATE_POOL_SIZE,
  });
  const proposals = pickProposalSlots(candidates, PROPOSALS_PER_ROUND);

  if (!proposals.length) {
    await prisma.schedulingRequest.update({
      where: { id: request.id },
      data: {
        status: "NEEDS_ATTENTION",
        attentionReason:
          "No open slots satisfy your constraints in the requested window",
      },
    });
    return { status: "NEEDS_ATTENTION" as const };
  }

  const body = await draftSchedulingEmailBody({
    userName,
    title: request.title,
    durationMinutes: request.durationMinutes,
    timeZone,
    slots: proposals,
    round: 1,
  });

  const sent = await sendGmailMessageWithToken(token, {
    to: attendeeEmails,
    subject: subjectFor(request.title, request.referenceToken),
    bodyText: body,
  });

  await prisma.schedulingRequest.update({
    where: { id: request.id },
    data: {
      status: "AWAITING_REPLIES",
      round: 1,
      proposedSlots: proposals as any,
      gmailThreadId: sent.threadId,
      lastPolledAt: new Date(),
    },
  });
  await prisma.schedulingMessage.create({
    data: {
      requestId: request.id,
      direction: "outbound",
      gmailMessageId: sent.id,
      fromEmail: userEmail,
      snippet: body.slice(0, 2000),
      round: 1,
    },
  });

  return { status: "AWAITING_REPLIES" as const, proposals };
}

function headerValue(message: any, name: string): string {
  const headers = message?.payload?.headers;
  if (!Array.isArray(headers)) return "";
  const h = headers.find(
    (x: any) => (x?.name || "").toLowerCase() === name.toLowerCase(),
  );
  return (h?.value as string) || "";
}

function emailAddressOf(fromHeader: string): string {
  const m = /<([^>]+)>/.exec(fromHeader);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

/** Whoever suggested a time obviously accepts it — record that, otherwise
 *  the booking check would wait forever for the proposer's "yes". */
async function markSuggestersAccepted(
  prisma: PrismaClient,
  requestId: string,
  slots: SuggestedSlot[],
) {
  const byEmail = new Map<string, string[]>();
  for (const s of slots) {
    const list = byEmail.get(s.suggestedBy) ?? [];
    list.push(s.startISO);
    byEmail.set(s.suggestedBy, list);
  }
  for (const [email, isos] of byEmail) {
    const attendee = await prisma.schedulingAttendee.findUnique({
      where: { requestId_email: { requestId, email } },
    });
    if (!attendee) continue;
    const availability = (attendee.parsedAvailability as any) || {};
    const accepted = new Set<string>(
      Array.isArray(availability.acceptedSlotStartISOs)
        ? availability.acceptedSlotStartISOs
        : [],
    );
    for (const iso of isos) accepted.add(iso);
    await prisma.schedulingAttendee.update({
      where: { id: attendee.id },
      data: {
        responseStatus: "ACCEPTED",
        parsedAvailability: {
          ...availability,
          acceptedSlotStartISOs: Array.from(accepted),
        } as any,
      },
    });
  }
}

/** Send a follow-up round on the existing thread and record it. */
async function sendNegotiationRound(
  prisma: PrismaClient,
  request: {
    id: string;
    title: string;
    durationMinutes: number;
    referenceToken: string;
    gmailThreadId: string | null;
    round: number;
    proposedSlots: unknown;
    attendees: Array<{ email: string }>;
  },
  ctx: { token: string; userEmail: string; userName: string; timeZone: string },
  slots: TimeSlot[],
  opts: { priorContext?: string; confirmNote?: string } = {},
) {
  const nextRound = request.round + 1;
  const body = await draftSchedulingEmailBody({
    userName: ctx.userName,
    title: request.title,
    durationMinutes: request.durationMinutes,
    timeZone: ctx.timeZone,
    slots,
    round: nextRound,
    priorContext: opts.priorContext,
    confirmNote: opts.confirmNote,
  });

  const sent = await sendGmailMessageWithToken(ctx.token, {
    to: request.attendees.map((a) => a.email),
    subject: subjectFor(request.title, request.referenceToken),
    bodyText: body,
    threadId: request.gmailThreadId || undefined,
  });

  const previous = (request.proposedSlots as unknown as TimeSlot[]) || [];
  await prisma.schedulingRequest.update({
    where: { id: request.id },
    data: {
      status: "NEGOTIATING",
      round: nextRound,
      // Cumulative: acceptances from earlier rounds still count.
      proposedSlots: [...previous, ...slots] as any,
      pendingSlots: null as any,
      lastPolledAt: new Date(),
    },
  });
  await prisma.schedulingMessage.create({
    data: {
      requestId: request.id,
      direction: "outbound",
      gmailMessageId: sent.id,
      fromEmail: ctx.userEmail,
      snippet: body.slice(0, 2000),
      round: nextRound,
    },
  });
  // New round: anyone who hasn't accepted must reply again. Otherwise the
  // next 5-minute poll still sees COUNTERED and sends another menu.
  await prisma.schedulingAttendee.updateMany({
    where: {
      requestId: request.id,
      responseStatus: { not: "ACCEPTED" },
    },
    data: { responseStatus: "PENDING" },
  });
}

/**
 * One polling pass: ingest new replies, update attendee state, then act
 * (book / re-propose / escalate / keep waiting).
 */
export async function pollSchedulingRequestCore(
  prisma: PrismaClient,
  requestId: string,
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { attendees: true },
  });
  if (!request) throw new Error("scheduling_request_not_found");
  if (!["AWAITING_REPLIES", "NEGOTIATING"].includes(request.status)) {
    return { status: request.status, action: "skipped" as const };
  }

  const { token, userEmail, userName } = await getGoogleContext(
    prisma,
    request.userId,
  );
  const settings = await getUserSettingsCore(request.userId);
  const timeZone = settings.timeZone || "UTC";
  const constraints = request.constraints as unknown as SchedulingConstraints;
  const proposedSlots = (request.proposedSlots as unknown as TimeSlot[]) || [];

  // Collect thread messages plus any off-thread replies that kept the
  // reference token in the subject.
  const rawMessages: any[] = [];
  if (request.gmailThreadId) {
    try {
      const thread = await getGmailThreadWithToken(
        token,
        request.gmailThreadId,
      );
      rawMessages.push(...thread.messages);
    } catch (err) {
      console.error("Scheduling thread fetch failed:", err);
    }
  }
  try {
    const offThread = await searchGmailMessagesWithToken(
      token,
      `"Olly#${request.referenceToken}"`,
      10,
    );
    rawMessages.push(...offThread);
  } catch (err) {
    console.error("Scheduling token search failed:", err);
  }

  const seen = await prisma.schedulingMessage.findMany({
    where: { requestId: request.id, gmailMessageId: { not: null } },
    select: { gmailMessageId: true },
  });
  const seenIds = new Set(seen.map((m) => m.gmailMessageId));

  const attendeeByEmail = new Map(
    request.attendees.map((a) => [a.email.toLowerCase(), a]),
  );

  const dedupedNew = new Map<string, any>();
  for (const message of rawMessages) {
    const id = message?.id as string | undefined;
    if (!id || seenIds.has(id) || dedupedNew.has(id)) continue;
    dedupedNew.set(id, message);
  }

  let needsHumanReason: string | null = null;
  const counterNotes: string[] = [];
  const suggestions: SuggestedSlot[] = [];
  let ingestedReplies = 0;

  for (const message of dedupedNew.values()) {
    const fromEmail = emailAddressOf(headerValue(message, "From"));
    if (!fromEmail || fromEmail === userEmail) continue;

    const bodyText =
      extractPlainTextFromGmailMessage(message) || message.snippet || "";
    const parsed = await parseSchedulingReply({
      fromEmail,
      bodyText,
      proposedSlots,
      timeZone,
    });

    try {
      await prisma.schedulingMessage.create({
        data: {
          requestId: request.id,
          direction: "inbound",
          gmailMessageId: message.id,
          fromEmail,
          snippet: (bodyText || "").slice(0, 2000),
          parsedIntent: parsed as any,
          round: request.round,
        },
      });
    } catch (err: any) {
      // Concurrent poll already recorded this message — skip it.
      if (err?.code === "P2002") continue;
      throw err;
    }

    const attendee = attendeeByEmail.get(fromEmail);
    if (!attendee) continue; // e.g. a forwarded reply from someone else
    ingestedReplies += 1;

    if (parsed.needsHuman) {
      needsHumanReason = `Reply from ${fromEmail} needs your attention: ${parsed.summary}`;
    }

    const availability = (attendee.parsedAvailability as any) || {};
    const accepted = new Set<string>(
      Array.isArray(availability.acceptedSlotStartISOs)
        ? availability.acceptedSlotStartISOs
        : [],
    );
    for (const iso of parsed.acceptedSlotStartISOs) accepted.add(iso);

    const notes: string[] = Array.isArray(availability.notes)
      ? availability.notes
      : [];
    if (parsed.availabilityNotes) {
      notes.push(parsed.availabilityNotes);
      counterNotes.push(`${fromEmail}: ${parsed.availabilityNotes}`);
    }
    suggestions.push(
      ...parsed.suggestedSlots.map((s) => ({ ...s, suggestedBy: fromEmail })),
    );

    let responseStatus = attendee.responseStatus;
    if (parsed.intent === "accept" && parsed.acceptedSlotStartISOs.length) {
      responseStatus = "ACCEPTED";
    } else if (parsed.intent === "decline_meeting") {
      responseStatus = "DECLINED";
    } else if (parsed.intent === "counter" || parsed.intent === "constraint") {
      responseStatus = "COUNTERED";
    }

    const updated = await prisma.schedulingAttendee.update({
      where: { id: attendee.id },
      data: {
        responseStatus,
        parsedAvailability: {
          acceptedSlotStartISOs: Array.from(accepted),
          notes,
        } as any,
      },
    });
    attendeeByEmail.set(fromEmail, updated);
  }

  if (needsHumanReason) {
    await prisma.schedulingRequest.update({
      where: { id: request.id },
      data: {
        status: "NEEDS_ATTENTION",
        attentionReason: needsHumanReason,
        lastPolledAt: new Date(),
      },
    });
    return { status: "NEEDS_ATTENTION" as const, action: "attention" as const };
  }

  const negotiationAttendees: AttendeeNegotiationState[] = Array.from(
    attendeeByEmail.values(),
  ).map((a) => ({
    email: a.email,
    required: a.required,
    responseStatus: a.responseStatus,
    acceptedSlotStartISOs: Array.isArray(
      (a.parsedAvailability as any)?.acceptedSlotStartISOs,
    )
      ? ((a.parsedAvailability as any).acceptedSlotStartISOs as string[])
      : [],
  }));

  const decision = decideNextNegotiationStep({
    proposedSlots,
    attendees: negotiationAttendees,
    round: request.round,
    maxRounds: SCHEDULING_MAX_ROUNDS,
  });

  if (decision.action === "book") {
    if (!request.autoBook) {
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: {
          status: "READY_TO_BOOK",
          bookedSlot: decision.slot as any,
          lastPolledAt: new Date(),
        },
      });
      return { status: "READY_TO_BOOK" as const, action: "ready" as const };
    }
    await bookRequest(prisma, request.id, decision.slot, {
      token,
      userEmail,
      userName,
      timeZone,
    });
    return { status: "BOOKED" as const, action: "booked" as const };
  }

  if (decision.action === "attention") {
    await prisma.schedulingRequest.update({
      where: { id: request.id },
      data: {
        status: "NEEDS_ATTENTION",
        attentionReason: decision.reason,
        lastPolledAt: new Date(),
      },
    });
    return { status: "NEEDS_ATTENTION" as const, action: "attention" as const };
  }

  if (decision.action === "propose") {
    // No new reply this pass — do not send another menu. This covers both
    // "they countered and we're waiting" and autoAltTimes confirmation
    // rounds waiting for the other attendees.
    if (ingestedReplies === 0) {
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: { lastPolledAt: new Date() },
      });
      return { status: request.status, action: "waited" as const };
    }

    const ctx = { token, userEmail, userName, timeZone };
    const windowStartMs = Date.parse(constraints.windowStartISO);
    const windowEndMs = Date.parse(constraints.windowEndISO);
    const durationMs = request.durationMinutes * 60 * 1000;
    const alreadyProposed = new Set(proposedSlots.map((s) => s.startISO));

    const suggestionTimes = suggestions
      .map((s) => Date.parse(s.startISO))
      .filter(Number.isFinite);
    const fbMin = new Date(Math.min(windowStartMs, ...suggestionTimes));
    const fbMax = new Date(
      Math.max(windowEndMs, ...suggestionTimes.map((t) => t + durationMs)),
    );

    let ownerBusy: OwnerBusy;
    try {
      ownerBusy = await loadOwnerBusy(token, userEmail, fbMin, fbMax);
    } catch (err) {
      console.error("Scheduling owner calendar read failed:", err);
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: {
          status: "NEEDS_ATTENTION",
          attentionReason:
            "Couldn't read your calendar to check the suggested times",
          lastPolledAt: new Date(),
        },
      });
      return {
        status: "NEEDS_ATTENTION" as const,
        action: "attention" as const,
      };
    }
    const busyMerged = mergeBusyIntervals(ownerBusy.busy);

    const freshSuggestions = suggestions.filter((s) => {
      const start = Date.parse(s.startISO);
      if (!Number.isFinite(start)) return false;
      if (start < Date.now()) return false;
      if (alreadyProposed.has(s.startISO)) return false;
      return true;
    });
    const annotated: SuggestedSlot[] = freshSuggestions
      .filter(
        (s, i, arr) => arr.findIndex((x) => x.startISO === s.startISO) === i,
      )
      .map((s) => {
        const start = Date.parse(s.startISO);
        const end = start + durationMs;
        const conflictTitle = conflictTitleFor(ownerBusy.events, start, end);
        const busy = Boolean(
          conflictTitle || busyMerged.some((b) => b.start < end && b.end > start),
        );
        return {
          ...s,
          calendarStatus: busy ? ("busy" as const) : ("free" as const),
          conflictTitle,
        };
      });

    const inWindow = (s: SuggestedSlot) => {
      const start = Date.parse(s.startISO);
      return start >= windowStartMs && start + durationMs <= windowEndMs;
    };
    const autoEligible = annotated.filter(
      (s) =>
        s.calendarStatus === "free" &&
        (inWindow(s) ? request.autoAltTimes : request.autoAltDates),
    );
    const needsApproval = annotated.filter((s) => !autoEligible.includes(s));

    // Any suggestion that needs you (outside the window, busy, or autonomy
    // off) pauses the thread. Don't also send a fresh menu.
    if (needsApproval.length) {
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: {
          status: "AWAITING_APPROVAL",
          pendingSlots: annotated.slice(0, 5) as any,
          lastPolledAt: new Date(),
        },
      });
      return {
        status: "AWAITING_APPROVAL" as const,
        action: "approval" as const,
      };
    }

    // In-window, free, autonomy on: book if everyone already agrees,
    // otherwise one confirmation email — then wait for a reply.
    if (autoEligible.length) {
      const confirmSlots = autoEligible.slice(0, PROPOSALS_PER_ROUND);
      await markSuggestersAccepted(prisma, request.id, confirmSlots);

      const refreshed = await prisma.schedulingAttendee.findMany({
        where: { requestId: request.id },
      });
      const refreshedStates: AttendeeNegotiationState[] = refreshed.map(
        (a) => ({
          email: a.email,
          required: a.required,
          responseStatus: a.responseStatus,
          acceptedSlotStartISOs: Array.isArray(
            (a.parsedAvailability as any)?.acceptedSlotStartISOs,
          )
            ? ((a.parsedAvailability as any).acceptedSlotStartISOs as string[])
            : [],
        }),
      );
      const recheck = decideNextNegotiationStep({
        proposedSlots: confirmSlots,
        attendees: refreshedStates,
        round: request.round,
        maxRounds: SCHEDULING_MAX_ROUNDS,
      });
      if (recheck.action === "book") {
        if (!request.autoBook) {
          await prisma.schedulingRequest.update({
            where: { id: request.id },
            data: {
              status: "READY_TO_BOOK",
              bookedSlot: recheck.slot as any,
              pendingSlots: null as any,
              lastPolledAt: new Date(),
            },
          });
          return { status: "READY_TO_BOOK" as const, action: "ready" as const };
        }
        await bookRequest(prisma, request.id, recheck.slot, ctx);
        return { status: "BOOKED" as const, action: "booked" as const };
      }

      const suggesters = Array.from(
        new Set(confirmSlots.map((s) => s.suggestedBy)),
      ).join(", ");
      await sendNegotiationRound(prisma, request, ctx, confirmSlots, {
        confirmNote: `${suggesters} suggested ${confirmSlots.length === 1 ? "this time" : "these times"}`,
      });
      return { status: "NEGOTIATING" as const, action: "confirming" as const };
    }

    // Countered with no concrete times — one fresh menu inside the window.
    const candidates = computeCandidateSlots({
      busy: ownerBusy.busy,
      constraints,
      preferences: preferencesFromSettings(settings),
      durationMinutes: request.durationMinutes,
      timeZone,
      maxSlots: CANDIDATE_POOL_SIZE,
    });
    const nextProposals = pickProposalSlots(
      candidates,
      PROPOSALS_PER_ROUND,
      alreadyProposed,
    );

    if (!nextProposals.length) {
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: {
          status: "NEEDS_ATTENTION",
          attentionReason:
            "No remaining slots satisfy everyone's stated constraints",
          lastPolledAt: new Date(),
        },
      });
      return {
        status: "NEEDS_ATTENTION" as const,
        action: "attention" as const,
      };
    }

    await sendNegotiationRound(prisma, request, ctx, nextProposals, {
      priorContext: counterNotes.join("; ") || undefined,
    });
    return { status: "NEGOTIATING" as const, action: "proposed" as const };
  }

  await prisma.schedulingRequest.update({
    where: { id: request.id },
    data: { lastPolledAt: new Date() },
  });
  return { status: request.status, action: "waited" as const };
}

async function bookRequest(
  prisma: PrismaClient,
  requestId: string,
  slot: TimeSlot,
  ctx: { token: string; userEmail: string; userName: string; timeZone: string },
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { attendees: true },
  });
  if (!request) throw new Error("scheduling_request_not_found");

  const event = await createCalendarEventWithToken(ctx.token, {
    summary: request.title,
    description: `Scheduled by Olly on behalf of ${ctx.userName}.`,
    startISO: slot.startISO,
    endISO: slot.endISO,
    timeZone: ctx.timeZone,
    attendeeEmails: request.attendees.map((a) => a.email),
  });

  await prisma.schedulingRequest.update({
    where: { id: request.id },
    data: {
      status: "BOOKED",
      bookedEventId: event.id,
      bookedSlot: slot as any,
      lastPolledAt: new Date(),
    },
  });

  // Confirm on the thread so attendees see closure even before the invite.
  const confirmation = [
    `Great — booked "${request.title}" for ${formatSlotForEmail(slot, ctx.timeZone)}.`,
    ``,
    `A calendar invite is on its way. Thanks everyone!`,
    ``,
    `Olly (scheduling for ${ctx.userName})`,
  ].join("\n");
  try {
    const sent = await sendGmailMessageWithToken(ctx.token, {
      to: request.attendees.map((a) => a.email),
      subject: subjectFor(request.title, request.referenceToken),
      bodyText: confirmation,
      threadId: request.gmailThreadId || undefined,
    });
    await prisma.schedulingMessage.create({
      data: {
        requestId: request.id,
        direction: "outbound",
        gmailMessageId: sent.id,
        fromEmail: ctx.userEmail,
        snippet: confirmation.slice(0, 2000),
        round: request.round,
      },
    });
  } catch (err) {
    // The event exists and invites were sent; a failed courtesy email
    // shouldn't fail the booking.
    console.error("Scheduling confirmation email failed:", err);
  }

  return event;
}

/** One-click booking for READY_TO_BOOK requests (autoBook off). */
export async function confirmSchedulingRequestCore(
  prisma: PrismaClient,
  requestId: string,
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
  });
  if (!request) throw new Error("scheduling_request_not_found");
  if (request.status !== "READY_TO_BOOK" || !request.bookedSlot) {
    throw new Error(`scheduling_request_not_ready:${request.status}`);
  }

  const { token, userEmail, userName } = await getGoogleContext(
    prisma,
    request.userId,
  );
  const settings = await getUserSettingsCore(request.userId);
  return bookRequest(
    prisma,
    requestId,
    request.bookedSlot as unknown as TimeSlot,
    {
      token,
      userEmail,
      userName,
      timeZone: settings.timeZone || "UTC",
    },
  );
}

/**
 * Owner approves attendee-suggested time(s) that needed sign-off: send the
 * confirmation round to attendees. Optionally restrict to specific slots.
 */
export async function approvePendingSlotsCore(
  prisma: PrismaClient,
  requestId: string,
  slotStartISOs?: string[],
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { attendees: true },
  });
  if (!request) throw new Error("scheduling_request_not_found");
  const pending = (request.pendingSlots as unknown as SuggestedSlot[]) || [];
  if (request.status !== "AWAITING_APPROVAL" || !pending.length) {
    throw new Error(`scheduling_request_not_awaiting_approval:${request.status}`);
  }

  const chosen = (
    slotStartISOs?.length
      ? pending.filter((s) => slotStartISOs.includes(s.startISO))
      : pending
  ).slice(0, PROPOSALS_PER_ROUND);
  if (!chosen.length) throw new Error("no_matching_pending_slots");

  const { token, userEmail, userName } = await getGoogleContext(
    prisma,
    request.userId,
  );
  const settings = await getUserSettingsCore(request.userId);
  const ctx = { token, userEmail, userName, timeZone: settings.timeZone || "UTC" };

  await markSuggestersAccepted(prisma, request.id, chosen);

  // If the approved time already has everyone's agreement (the suggester
  // accepted by suggesting it), book it — don't ask them to re-confirm.
  const refreshed = await prisma.schedulingAttendee.findMany({
    where: { requestId: request.id },
  });
  const refreshedStates: AttendeeNegotiationState[] = refreshed.map((a) => ({
    email: a.email,
    required: a.required,
    responseStatus: a.responseStatus,
    acceptedSlotStartISOs: Array.isArray(
      (a.parsedAvailability as any)?.acceptedSlotStartISOs,
    )
      ? ((a.parsedAvailability as any).acceptedSlotStartISOs as string[])
      : [],
  }));
  const recheck = decideNextNegotiationStep({
    proposedSlots: chosen,
    attendees: refreshedStates,
    round: request.round,
    maxRounds: SCHEDULING_MAX_ROUNDS,
  });
  if (recheck.action === "book") {
    if (!request.autoBook) {
      await prisma.schedulingRequest.update({
        where: { id: request.id },
        data: {
          status: "READY_TO_BOOK",
          bookedSlot: recheck.slot as any,
          pendingSlots: null as any,
          lastPolledAt: new Date(),
        },
      });
      return { confirmed: chosen.length, status: "READY_TO_BOOK" as const };
    }
    await bookRequest(prisma, request.id, recheck.slot, ctx);
    return { confirmed: chosen.length, status: "BOOKED" as const };
  }

  const suggesters = Array.from(
    new Set(chosen.map((s) => s.suggestedBy)),
  ).join(", ");
  await sendNegotiationRound(prisma, request, ctx, chosen, {
    confirmNote: `${suggesters} suggested ${chosen.length === 1 ? "this time" : "these times"}`,
  });
  return { confirmed: chosen.length, status: "NEGOTIATING" as const };
}

/**
 * Owner declines the suggested time(s): drop them and ask attendees for
 * other options with a fresh menu inside the original constraints.
 */
export async function rejectPendingSlotsCore(
  prisma: PrismaClient,
  requestId: string,
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { attendees: true },
  });
  if (!request) throw new Error("scheduling_request_not_found");
  if (request.status !== "AWAITING_APPROVAL") {
    throw new Error(`scheduling_request_not_awaiting_approval:${request.status}`);
  }

  const { token, userEmail, userName } = await getGoogleContext(
    prisma,
    request.userId,
  );
  const settings = await getUserSettingsCore(request.userId);
  const timeZone = settings.timeZone || "UTC";
  const constraints = request.constraints as unknown as SchedulingConstraints;
  const proposedSlots = (request.proposedSlots as unknown as TimeSlot[]) || [];
  const alreadyProposed = new Set(proposedSlots.map((s) => s.startISO));

  const ownerBusy = await loadOwnerBusy(
    token,
    userEmail,
    new Date(constraints.windowStartISO),
    new Date(constraints.windowEndISO),
  );
  const candidates = computeCandidateSlots({
    busy: ownerBusy.busy,
    constraints,
    preferences: preferencesFromSettings(settings),
    durationMinutes: request.durationMinutes,
    timeZone,
    maxSlots: CANDIDATE_POOL_SIZE,
  });
  const nextProposals = pickProposalSlots(
    candidates,
    PROPOSALS_PER_ROUND,
    alreadyProposed,
  );

  if (!nextProposals.length) {
    await prisma.schedulingRequest.update({
      where: { id: request.id },
      data: {
        status: "NEEDS_ATTENTION",
        attentionReason:
          "You declined the suggested times and no other open slots remain in the window",
        pendingSlots: null as any,
      },
    });
    return { status: "NEEDS_ATTENTION" as const };
  }

  await sendNegotiationRound(
    prisma,
    request,
    { token, userEmail, userName, timeZone },
    nextProposals,
    {
      priorContext:
        "the previously suggested times unfortunately don't work for the organizer",
    },
  );
  return { status: "NEGOTIATING" as const };
}

export async function cancelSchedulingRequestCore(
  prisma: PrismaClient,
  requestId: string,
) {
  await prisma.schedulingRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
}

/** Polite reminder to attendees who haven't replied yet. */
export async function nudgeSchedulingRequestCore(
  prisma: PrismaClient,
  requestId: string,
) {
  const request = await prisma.schedulingRequest.findUnique({
    where: { id: requestId },
    include: { attendees: true },
  });
  if (!request) throw new Error("scheduling_request_not_found");
  if (!["AWAITING_REPLIES", "NEGOTIATING"].includes(request.status)) {
    throw new Error(`scheduling_request_not_nudgeable:${request.status}`);
  }

  const pending = request.attendees.filter(
    (a) => a.responseStatus === "PENDING",
  );
  if (!pending.length) return { nudged: 0 };

  const { token, userEmail, userName } = await getGoogleContext(
    prisma,
    request.userId,
  );
  const settings = await getUserSettingsCore(request.userId);
  const timeZone = settings.timeZone || "UTC";
  const proposedSlots = (request.proposedSlots as unknown as TimeSlot[]) || [];
  const recent = proposedSlots.slice(-PROPOSALS_PER_ROUND);

  const body = [
    `Hi all — a gentle reminder about finding a time for "${request.title}".`,
    ``,
    `The proposed options are:`,
    ...recent.map((s, i) => `${i + 1}. ${formatSlotForEmail(s, timeZone)}`),
    ``,
    `A quick reply with what works (or doesn't) would be a big help. Thanks!`,
    ``,
    `Olly (scheduling for ${userName})`,
  ].join("\n");

  const sent = await sendGmailMessageWithToken(token, {
    to: pending.map((a) => a.email),
    subject: subjectFor(request.title, request.referenceToken),
    bodyText: body,
    threadId: request.gmailThreadId || undefined,
  });
  await prisma.schedulingMessage.create({
    data: {
      requestId: request.id,
      direction: "outbound",
      gmailMessageId: sent.id,
      fromEmail: userEmail,
      snippet: body.slice(0, 2000),
      round: request.round,
    },
  });
  return { nudged: pending.length };
}
