/**
 * Deterministic availability engine for Olly-arranged meetings.
 *
 * Pure functions only: given busy intervals (from Google free/busy), the
 * user's standing preferences, and per-request constraints, produce ranked
 * candidate slots. No LLM, no I/O — fully unit-testable.
 */

export type TimeSlot = { startISO: string; endISO: string };

export type BusyInterval = { start: string; end: string };

export type TimeOfDayPreference = "morning" | "afternoon" | "evening" | "any";

export type SchedulingConstraints = {
  /** Earliest instant to consider (inclusive). */
  windowStartISO: string;
  /** Latest instant to consider (exclusive). */
  windowEndISO: string;
  timeOfDay?: TimeOfDayPreference;
  /** ISO weekday numbers (Mon=1..Sun=7). Overrides standing workingDays. */
  allowedDays?: number[];
  notes?: string;
  /**
   * When set, the time is already agreed: book this exact start (ISO 8601
   * UTC) directly, with no proposals or email negotiation.
   */
  fixedStartISO?: string;
};

export type SchedulingPreferences = {
  workingHoursStart: string | null; // "09:00"
  workingHoursEnd: string | null; // "17:00"
  workingDays: number[]; // ISO weekday numbers
  meetingBufferMinutes: number;
  minSchedulingNoticeHours: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_STEP_MINUTES = 30;

// Time-of-day windows in local minutes-from-midnight.
const TIME_OF_DAY_WINDOWS: Record<
  Exclude<TimeOfDayPreference, "any">,
  { start: number; end: number }
> = {
  morning: { start: 8 * 60, end: 12 * 60 },
  afternoon: { start: 12 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 20 * 60 },
};

export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function zoneOffsetMs(timeZone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(utcDate)) {
    parts[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10),
  );
  return asUTC - utcDate.getTime();
}

/** UTC instant for "local calendar date + minutes from midnight" in a zone. */
function zonedTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minutesFromMidnight / 60),
    minutesFromMidnight % 60,
  );
  // Two passes handle DST transitions: the offset at the guess is usually
  // the offset at the actual local time.
  let guess = new Date(naive - zoneOffsetMs(timeZone, new Date(naive)));
  guess = new Date(naive - zoneOffsetMs(timeZone, guess));
  return guess;
}

function zoneCalendarDate(
  timeZone: string,
  utcDate: Date,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(utcDate)) {
    parts[p.type] = p.value;
  }
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
  };
}

function isoWeekday(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun
  return d === 0 ? 7 : d;
}

/** Merge overlapping/adjacent busy intervals into a sorted disjoint list. */
export function mergeBusyIntervals(
  intervals: BusyInterval[],
): Array<{ start: number; end: number }> {
  const parsed = intervals
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const b of parsed) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
}

function overlapsBusy(
  merged: Array<{ start: number; end: number }>,
  start: number,
  end: number,
): boolean {
  // merged is sorted; linear scan is fine for the volumes involved.
  for (const b of merged) {
    if (b.start >= end) break;
    if (b.end > start) return true;
  }
  return false;
}

export interface ComputeCandidateSlotsInput {
  busy: BusyInterval[];
  constraints: SchedulingConstraints;
  preferences: SchedulingPreferences;
  durationMinutes: number;
  timeZone: string;
  now?: Date;
  maxSlots?: number;
}

/**
 * Produce chronologically ordered open slots that satisfy every constraint:
 * inside the request window, on allowed weekdays, within working hours
 * intersected with the time-of-day preference, past the minimum notice,
 * and clear of busy intervals (padded by the meeting buffer).
 */
export function computeCandidateSlots(
  input: ComputeCandidateSlotsInput,
): TimeSlot[] {
  const {
    busy,
    constraints,
    preferences,
    durationMinutes,
    timeZone,
  } = input;
  const now = input.now ?? new Date();
  const maxSlots = input.maxSlots ?? 20;

  const windowStart = Date.parse(constraints.windowStartISO);
  const windowEnd = Date.parse(constraints.windowEndISO);
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return [];
  if (windowEnd <= windowStart) return [];

  const merged = mergeBusyIntervals(busy);
  const bufferMs = Math.max(0, preferences.meetingBufferMinutes) * 60 * 1000;
  const earliestStart = Math.max(
    windowStart,
    now.getTime() + Math.max(0, preferences.minSchedulingNoticeHours) * 60 * 60 * 1000,
  );

  const workStart = parseHHMM(preferences.workingHoursStart) ?? 9 * 60;
  const workEnd = parseHHMM(preferences.workingHoursEnd) ?? 17 * 60;
  const allowedDays =
    constraints.allowedDays?.length
      ? constraints.allowedDays
      : preferences.workingDays.length
        ? preferences.workingDays
        : [1, 2, 3, 4, 5];

  // Daily local window: working hours intersected with the time-of-day
  // preference. If they don't intersect (e.g. "evenings" for a 9-5 user),
  // honor the explicit request over the standing preference.
  let dayWindow = { start: workStart, end: workEnd };
  const pref = constraints.timeOfDay;
  if (pref && pref !== "any") {
    const tod = TIME_OF_DAY_WINDOWS[pref];
    const intersect = {
      start: Math.max(workStart, tod.start),
      end: Math.min(workEnd, tod.end),
    };
    dayWindow = intersect.end > intersect.start ? intersect : tod;
  }

  const slots: TimeSlot[] = [];
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = SLOT_STEP_MINUTES * 60 * 1000;

  // Walk calendar days in the user's zone across the window.
  const seenDays = new Set<string>();
  for (
    let cursor = windowStart;
    cursor < windowEnd + DAY_MS && slots.length < maxSlots;
    cursor += DAY_MS
  ) {
    const { year, month, day } = zoneCalendarDate(timeZone, new Date(cursor));
    const dayKey = `${year}-${month}-${day}`;
    if (seenDays.has(dayKey)) continue;
    seenDays.add(dayKey);

    if (!allowedDays.includes(isoWeekday(year, month, day))) continue;

    const dayStartUtc = zonedTimeToUtc(year, month, day, dayWindow.start, timeZone);
    const dayEndUtc = zonedTimeToUtc(year, month, day, dayWindow.end, timeZone);

    for (
      let t = dayStartUtc.getTime();
      t + durationMs <= dayEndUtc.getTime() && slots.length < maxSlots;
      t += stepMs
    ) {
      const end = t + durationMs;
      if (t < earliestStart) continue;
      if (t < windowStart || end > windowEnd) continue;
      if (overlapsBusy(merged, t - bufferMs, end + bufferMs)) continue;
      slots.push({
        startISO: new Date(t).toISOString(),
        endISO: new Date(end).toISOString(),
      });
    }
  }

  return slots;
}

/**
 * Pick up to `count` slots to actually propose, spreading them across
 * distinct days when possible so recipients get real alternatives.
 */
export function pickProposalSlots(
  candidates: TimeSlot[],
  count = 3,
  excludeISO: Set<string> = new Set(),
): TimeSlot[] {
  const fresh = candidates.filter((s) => !excludeISO.has(s.startISO));
  const byDay = new Map<string, TimeSlot[]>();
  for (const slot of fresh) {
    const day = slot.startISO.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(slot);
    byDay.set(day, list);
  }

  const picked: TimeSlot[] = [];
  // Round-robin across days (already chronological within each day).
  const dayLists = Array.from(byDay.values());
  for (let round = 0; picked.length < count; round += 1) {
    let addedAny = false;
    for (const list of dayLists) {
      if (picked.length >= count) break;
      const slot = list[round];
      if (slot) {
        picked.push(slot);
        addedAny = true;
      }
    }
    if (!addedAny) break;
  }

  return picked.sort(
    (a, b) => Date.parse(a.startISO) - Date.parse(b.startISO),
  );
}

export type AttendeeNegotiationState = {
  email: string;
  required: boolean;
  responseStatus: string; // PENDING | ACCEPTED | DECLINED | COUNTERED
  /** Proposed-slot startISOs this attendee has accepted. */
  acceptedSlotStartISOs: string[];
};

export type NegotiationDecision =
  | { action: "book"; slot: TimeSlot }
  | { action: "propose" }
  | { action: "wait" }
  | { action: "attention"; reason: string };

/**
 * Deterministic next step for a negotiation round.
 *
 * - Book when every required attendee has accepted a common proposed slot
 *   (preferring slots that the most optional attendees also accepted).
 * - Escalate when a required attendee declined the meeting outright or the
 *   round budget is exhausted.
 * - Re-propose when all required attendees responded but no slot works.
 * - Otherwise keep waiting for replies.
 */
export function decideNextNegotiationStep(input: {
  proposedSlots: TimeSlot[];
  attendees: AttendeeNegotiationState[];
  round: number;
  maxRounds: number;
}): NegotiationDecision {
  const { proposedSlots, attendees, round, maxRounds } = input;
  const required = attendees.filter((a) => a.required);
  const optional = attendees.filter((a) => !a.required);

  const declined = required.find((a) => a.responseStatus === "DECLINED");
  if (declined) {
    return {
      action: "attention",
      reason: `${declined.email} declined the meeting`,
    };
  }

  if (required.length > 0) {
    const commonSlots = proposedSlots.filter((slot) =>
      required.every((a) => a.acceptedSlotStartISOs.includes(slot.startISO)),
    );
    if (commonSlots.length > 0) {
      const best = commonSlots
        .map((slot) => ({
          slot,
          optionalYes: optional.filter((a) =>
            a.acceptedSlotStartISOs.includes(slot.startISO),
          ).length,
        }))
        .sort(
          (a, b) =>
            b.optionalYes - a.optionalYes ||
            Date.parse(a.slot.startISO) - Date.parse(b.slot.startISO),
        )[0];
      return { action: "book", slot: best.slot };
    }
  }

  const allRequiredResponded =
    required.length > 0 &&
    required.every((a) => a.responseStatus !== "PENDING");

  if (allRequiredResponded) {
    if (round >= maxRounds) {
      return {
        action: "attention",
        reason: `no common time found after ${round} rounds`,
      };
    }
    return { action: "propose" };
  }

  return { action: "wait" };
}
