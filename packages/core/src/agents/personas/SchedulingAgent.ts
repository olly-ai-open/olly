/**
 * SchedulingAgent - LLM brain for Olly-arranged meetings.
 *
 * Unlike the tool-loop personas, scheduling needs three single-shot
 * structured calls (parse the user's direction, draft outreach emails,
 * parse attendee replies). Deterministic code in meetingScheduling-core
 * decides what to do with the results.
 */

import { z } from "zod";
import { createStructuredCompletion, isLLMConfigured } from "../../llm";
import {
  SCHEDULING_DIRECTION_PROMPT,
  SCHEDULING_OUTREACH_PROMPT,
  SCHEDULING_REPLY_PROMPT,
} from "../../prompts/schedulingPrompts";
import type {
  TimeSlot,
  TimeOfDayPreference,
} from "../../core/availability-core";

const DirectionSchema = z.object({
  title: z.string(),
  durationMinutes: z.number(),
  windowStartISO: z.string(),
  windowEndISO: z.string(),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "any"]),
  fixedStartISO: z.string().nullable(),
  attendees: z.array(
    z.object({ name: z.string(), email: z.string(), required: z.boolean() }),
  ),
  notes: z.string(),
});

const OutreachSchema = z.object({ body: z.string() });

const ReplySchema = z.object({
  intent: z.enum([
    "accept",
    "decline_meeting",
    "counter",
    "constraint",
    "question",
    "other",
  ]),
  acceptedSlotStartISOs: z.array(z.string()),
  availabilityNotes: z.string(),
  suggestedSlots: z.array(z.object({ startISO: z.string(), endISO: z.string() })),
  needsHuman: z.boolean(),
  summary: z.string(),
});

/** "Tue, Aug 18, 9:00 – 9:30 AM PDT" — used in outreach emails and the UI. */
export function formatSlotForEmail(slot: TimeSlot, timeZone: string): string {
  const start = new Date(slot.startISO);
  const end = new Date(slot.endISO);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const startTime = time.format(start);
  const endTime = time.format(end);
  // "9:00 AM PDT" / "9:30 AM PDT" -> "9:00 – 9:30 AM PDT"
  return `${day}, ${startTime.replace(/ ([AP]M .*)$/, "")} – ${endTime}`;
}

export type ParsedSchedulingDirection = {
  title: string;
  durationMinutes: number;
  windowStartISO: string;
  windowEndISO: string;
  timeOfDay: TimeOfDayPreference;
  /** Set when the user stated an already-agreed exact time to book directly. */
  fixedStartISO: string | null;
  attendees: Array<{ name: string; email: string; required: boolean }>;
  notes: string;
};

export async function parseSchedulingDirection(input: {
  direction: string;
  timeZone: string;
  now?: Date;
  knownPeople: Array<{ name: string | null; email: string }>;
}): Promise<ParsedSchedulingDirection | null> {
  if (!isLLMConfigured()) return null;

  const now = input.now ?? new Date();
  const contacts = input.knownPeople
    .slice(0, 200)
    .map((p) => `- ${p.name || "(no name)"} <${p.email}>`)
    .join("\n");

  const user = [
    `Current date/time: ${now.toISOString()} (user time zone: ${input.timeZone})`,
    `Known contacts:\n${contacts || "(none)"}`,
    `User direction: ${input.direction}`,
    "Return only the JSON object as described.",
  ].join("\n\n");

  const { object: parsed } = await createStructuredCompletion(
    [
      { role: "system", content: SCHEDULING_DIRECTION_PROMPT },
      { role: "user", content: user },
    ],
    DirectionSchema,
    { name: "scheduling_direction" },
  );
  if (!parsed || !Array.isArray(parsed.attendees)) return null;

  return {
    title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Meeting",
    durationMinutes:
      typeof parsed.durationMinutes === "number" && parsed.durationMinutes >= 15
        ? Math.min(parsed.durationMinutes, 480)
        : 30,
    windowStartISO: parsed.windowStartISO,
    windowEndISO: parsed.windowEndISO,
    timeOfDay: ["morning", "afternoon", "evening", "any"].includes(parsed.timeOfDay)
      ? parsed.timeOfDay
      : "any",
    fixedStartISO:
      typeof parsed.fixedStartISO === "string" &&
      Number.isFinite(Date.parse(parsed.fixedStartISO))
        ? new Date(parsed.fixedStartISO).toISOString()
        : null,
    attendees: parsed.attendees
      .filter((a) => a && (a.email || a.name))
      .map((a) => ({
        name: typeof a.name === "string" ? a.name : "",
        email: typeof a.email === "string" ? a.email.trim().toLowerCase() : "",
        required: a.required !== false,
      })),
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

export async function draftSchedulingEmailBody(input: {
  userName: string;
  title: string;
  durationMinutes: number;
  timeZone: string;
  slots: TimeSlot[];
  round: number;
  priorContext?: string;
  /**
   * When set, this round confirms attendee-suggested time(s) rather than
   * offering a menu, e.g. "jane@acme.com suggested this time". The email
   * should ask the others to confirm exactly these slots.
   */
  confirmNote?: string;
}): Promise<string> {
  const formattedSlots = input.slots.map(
    (s, i) => `${i + 1}. ${formatSlotForEmail(s, input.timeZone)}`,
  );

  // Deterministic fallbacks keep the loop functional without an LLM key.
  const fallback = input.confirmNote
    ? [
        `Hi all,`,
        ``,
        `Following up on "${input.title}" — ${input.confirmNote}:`,
        ``,
        ...formattedSlots,
        ``,
        `Does ${input.slots.length === 1 ? "this time" : "one of these times"} work for everyone? A quick yes/no and we'll get it on the calendar.`,
        ``,
        `Thanks!`,
        `Olly (scheduling for ${input.userName})`,
      ].join("\n")
    : [
        `Hi all,`,
        ``,
        `I'm helping ${input.userName} find ${input.durationMinutes} minutes for "${input.title}". Would any of these times work for you?`,
        ``,
        ...formattedSlots,
        ``,
        `Please reply with the option(s) that work — or share a few times that do if none of these fit.`,
        ``,
        `Thanks!`,
        `Olly (scheduling for ${input.userName})`,
      ].join("\n");

  if (!isLLMConfigured()) return fallback;

  const user = [
    `User the email is sent on behalf of: ${input.userName}`,
    `Meeting title: ${input.title}`,
    `Duration: ${input.durationMinutes} minutes`,
    `Negotiation round: ${input.round}`,
    `Proposed slots (list exactly as given):\n${formattedSlots.join("\n")}`,
    input.confirmNote
      ? `Round type: CONFIRMATION — ${input.confirmNote}. Ask the other attendees to confirm exactly these time(s); do NOT offer alternatives.`
      : "Round type: proposal (offer the listed options)",
    input.priorContext
      ? `Prior-round context: ${input.priorContext}`
      : "Prior-round context: (first outreach)",
    "Return only the JSON object as described.",
  ].join("\n\n");

  try {
    const { object: parsed } = await createStructuredCompletion(
      [
        { role: "system", content: SCHEDULING_OUTREACH_PROMPT },
        { role: "user", content: user },
      ],
      OutreachSchema,
      { name: "scheduling_email" },
    );
    if (parsed?.body && parsed.body.trim().length > 20) {
      return parsed.body.trim();
    }
  } catch (err) {
    console.error("Scheduling outreach draft failed, using fallback:", err);
  }
  return fallback;
}

export type ParsedSchedulingReply = {
  intent:
    | "accept"
    | "decline_meeting"
    | "counter"
    | "constraint"
    | "question"
    | "other";
  acceptedSlotStartISOs: string[];
  availabilityNotes: string;
  suggestedSlots: TimeSlot[];
  needsHuman: boolean;
  summary: string;
};

export async function parseSchedulingReply(input: {
  fromEmail: string;
  bodyText: string;
  proposedSlots: TimeSlot[];
  timeZone: string;
  now?: Date;
}): Promise<ParsedSchedulingReply> {
  const needsHumanFallback: ParsedSchedulingReply = {
    intent: "other",
    acceptedSlotStartISOs: [],
    availabilityNotes: "",
    suggestedSlots: [],
    needsHuman: true,
    summary: "Reply could not be interpreted automatically",
  };

  if (!isLLMConfigured()) return needsHumanFallback;

  const now = input.now ?? new Date();
  const slotList = input.proposedSlots
    .map(
      (s, i) =>
        `${i + 1}. ${formatSlotForEmail(s, input.timeZone)} (startISO: ${s.startISO}, endISO: ${s.endISO})`,
    )
    .join("\n");

  const user = [
    `Current date/time: ${now.toISOString()} (user time zone: ${input.timeZone})`,
    `Proposed slots:\n${slotList || "(none)"}`,
    `Reply from: ${input.fromEmail}`,
    `Reply text:\n${input.bodyText.slice(0, 6000)}`,
    "Return only the JSON object as described.",
  ].join("\n\n");

  try {
    const { object: parsed } = await createStructuredCompletion(
      [
        { role: "system", content: SCHEDULING_REPLY_PROMPT },
        { role: "user", content: user },
      ],
      ReplySchema,
      { name: "scheduling_reply" },
    );
    if (!parsed || typeof parsed.intent !== "string") return needsHumanFallback;

    const validStartISOs = new Set(
      input.proposedSlots.map((s) => s.startISO),
    );
    return {
      intent: [
        "accept",
        "decline_meeting",
        "counter",
        "constraint",
        "question",
        "other",
      ].includes(parsed.intent)
        ? parsed.intent
        : "other",
      acceptedSlotStartISOs: Array.isArray(parsed.acceptedSlotStartISOs)
        ? parsed.acceptedSlotStartISOs.filter((iso) => validStartISOs.has(iso))
        : [],
      availabilityNotes:
        typeof parsed.availabilityNotes === "string"
          ? parsed.availabilityNotes
          : "",
      suggestedSlots: Array.isArray(parsed.suggestedSlots)
        ? parsed.suggestedSlots.filter(
            (s) =>
              s &&
              typeof s.startISO === "string" &&
              typeof s.endISO === "string" &&
              Number.isFinite(Date.parse(s.startISO)) &&
              Number.isFinite(Date.parse(s.endISO)),
          )
        : [],
      needsHuman: parsed.needsHuman === true,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "(no summary)",
    };
  } catch (err) {
    console.error("Scheduling reply parse failed:", err);
    return needsHumanFallback;
  }
}
