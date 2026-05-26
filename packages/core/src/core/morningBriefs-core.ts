import type { PrismaClient } from "@prisma/client";
import { listEventsByDayWithToken } from "../google-http";
import { MorningBriefAgent } from "../agents/personas/MorningBriefAgent";
import { getAccessTokenFromAccountCore } from "./google-core";
import { getUserSettingsCore } from "./settings-core";
import {
  normalizeIgnorePatterns,
  shouldIgnoreEventByTitle,
} from "./eventFilters-core";
import { safeParseMorningBriefJSON, type MorningBriefJSON } from "../llm";

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

export async function generateMorningBriefForUserCore(
  prisma: PrismaClient,
  userId: string,
  dayISOOverride?: string,
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

  const token = await getAccessTokenFromAccountCore(prisma, account as any);

  const events = await listEventsByDayWithToken(token, dayISO, timeZone);
  const filteredEvents = ignorePatterns.length
    ? events.filter((evt) =>
        shouldIgnoreEventByTitle(evt.title, ignorePatterns) ? false : true,
      )
    : events;

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

  const agent = new MorningBriefAgent({
    telemetryEnabled: settings.telemetryOptIn !== false,
  });
  const rawBrief = await agent.generateMorningBrief(userId, {
    date: dayISO,
    timeZone,
    actionItems: actionItemsForBrief,
  });
  const parsed = safeParseMorningBriefJSON(rawBrief);
  const morning: MorningBriefJSON = parsed ?? {
    brief_markdown: rawBrief,
    highlighted_action_item_ids: [],
  };
  // Safely extract sources from parsed JSON (may be null if LLM returned plain text)
  const sources = (parsed as any)?.sources;
  const confidence =
    Array.isArray(sources) && sources.length >= 3
      ? "high"
      : Array.isArray(sources) && sources.length > 0
        ? "medium"
        : "low";
  const formattedSources = Array.isArray(sources)
    ? sources.map((src: any) => `${src.type}: ${src.title} -> ${src.url}`)
    : [];

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
      content: JSON.stringify({
        brief_markdown: morning.brief_markdown,
        highlighted_action_item_ids: morning.highlighted_action_item_ids,
      }),
      confidence,
      sources: JSON.stringify(formattedSources),
    },
  });

  return { briefId: savedBrief ? savedBrief.id : "" };
}
