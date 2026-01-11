import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAccessTokenFromAccount,
  listEventsByDayWithToken,
} from "@/lib/google";
import { getUserSettings } from "@/lib/settings";
import {
  didUserDeclineEvent,
  sendBriefReadyWebPush,
  MorningBriefAgent,
  flushLangfuse,
} from "@olly/core";
import { generateMeetingBriefForEvent } from "@/lib/meetingBriefs";
import { safeParseMorningBriefJSON, type MorningBriefJSON } from "@olly/core";

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

export async function POST(req: Request) {
  // NOTE: Ephemeral meeting-brief mode:
  // When true, we treat per-meeting briefs used during morning-brief generation
  // as ephemeral: generateMeetingBriefForEvent is called with persist=false so
  // no Meeting/Brief rows are created or updated.
  const USE_EPHEMERAL_MEETING_BRIEFS_FOR_MORNING = true;

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const userId = session.user.id;

  let body: any = {};
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await req.json().catch(() => ({}));
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    body = { day: form.get("day") as string | null };
  }
  const scheduled = body?.scheduled === true;

  try {
    const settings = await getUserSettings(userId);
    const timeZone = settings.timeZone || "UTC";
    const todayISO = toDayInTimeZone(new Date(), timeZone);
    const dayISO =
      typeof body?.day === "string" && body.day.trim().length
        ? body.day.trim()
        : todayISO;

    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) {
      return NextResponse.json(
        { ok: false, error: "no_account" },
        { status: 404 },
      );
    }

    const token = await getAccessTokenFromAccount(account);
    const events = await listEventsByDayWithToken(token, dayISO, timeZone);

    const userEmail =
      (
        await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true },
        })
      )?.email ?? null;

    const filteredEvents = userEmail
      ? (events as any[]).filter(
          (e: any) =>
            !didUserDeclineEvent(e.attendees, { currentUserEmail: userEmail }),
        )
      : (events as any[]);

    // Look up existing meetings and their latest briefs (for goals)
    const eventIds = filteredEvents.map((e: any) => e.id as string);
    const existingMeetings = await prisma.meeting.findMany({
      where: { userId, externalId: { in: eventIds } },
      include: {
        briefs: { orderBy: { generatedAt: "desc" }, take: 1 },
      },
    });

    const existingByExternalId = new Map<
      string,
      (typeof existingMeetings)[number]
    >();
    for (const m of existingMeetings) {
      existingByExternalId.set(m.externalId as string, m);
    }

    const goalsByExternalId = new Map<string, string[]>();
    for (const m of existingMeetings as any[]) {
      const latest = m.briefs?.[0];
      if (!latest) continue;
      const c: any = latest.content as any;
      const goals: string[] = Array.isArray(c?.goals)
        ? (c.goals as any[])
            .map((g: any) => (typeof g === "string" ? g.trim() : ""))
            .filter(Boolean)
        : [];
      if (goals.length) {
        goalsByExternalId.set(m.externalId as string, goals.slice(0, 5));
      }
    }

    // For events without a stored brief/goals, generate an in-memory brief
    // (no DB writes) to extract goals for the morning summary.
    for (const evt of filteredEvents as any[]) {
      const externalId = evt.id as string;
      if (goalsByExternalId.has(externalId)) continue;

      try {
        const result = await generateMeetingBriefForEvent({
          userId,
          eventId: externalId,
          token,
          userSettings: settings,
          persist: !USE_EPHEMERAL_MEETING_BRIEFS_FOR_MORNING ? true : false,
        });
        const content: any = result.content as any;
        const goals: string[] = Array.isArray(content?.goals)
          ? (content.goals as any[])
              .map((g: any) => (typeof g === "string" ? g.trim() : ""))
              .filter(Boolean)
          : [];
        if (goals.length) {
          goalsByExternalId.set(externalId, goals.slice(0, 5));
        }
      } catch (e) {
        console.error(
          "Failed to generate ephemeral meeting brief for event",
          externalId,
          e,
        );
      }
    }

    // Candidate action items: open/self tasks, limited set
    const actionItemsDb = await prisma.actionItem.findMany({
      where: {
        userId,
        NOT: { status: "deleted" },
        OR: [{ status: null }, { status: { in: ["open", "todo"] } }],
      },
      include: {
        assignees: { include: { person: true } },
        brief: {
          include: {
            meeting: true,
            people: { include: { person: true } },
          },
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    });

    const actionItemsForBrief = actionItemsDb.map((ai: any) => {
      const relatedPeopleSet = new Map<
        string,
        { name?: string | null; email?: string | null }
      >();

      for (const a of ai.assignees || []) {
        if (a.person) {
          relatedPeopleSet.set(a.person.id, {
            name: a.person.name,
            email: a.person.email,
          });
        }
      }
      for (const bp of ai.brief?.people || []) {
        if (bp.person) {
          relatedPeopleSet.set(bp.person.id, {
            name: bp.person.name,
            email: bp.person.email,
          });
        }
      }

      const relatedMeetings: string[] = [];
      if (ai.brief?.meeting) {
        relatedMeetings.push(ai.brief.meeting.id as string);
      }

      return {
        id: ai.id as string,
        title: ai.title as string,
        dueAt: ai.dueAt ? (ai.dueAt as Date).toISOString() : null,
        status: (ai.status as string) || null,
        relatedMeetings,
        relatedPeople: Array.from(relatedPeopleSet.values()),
      };
    });

    const agent = new MorningBriefAgent({
      telemetryEnabled: settings.telemetryOptIn !== false,
    });
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

    // Create a synthetic "meeting" to host the morning brief
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

    const saved = await prisma.brief.create({
      data: {
        meetingId: morningMeeting.id,
        content: {
          brief_markdown: morning.brief_markdown,
          highlighted_action_item_ids: morning.highlighted_action_item_ids,
        },
        confidence:
          fullJson.sources?.length >= 3
            ? "high"
            : fullJson.sources?.length > 0
              ? "medium"
              : "low",
        sources: fullJson.sources?.map((src: any) => {
          return `${src.type}: ${src.title} -> ${src.url}`;
        }),
      },
    });

    if (scheduled) {
      sendBriefReadyWebPush(prisma, {
        userId,
        briefId: saved.id,
        kind: "MORNING_BRIEF",
      }).catch((err) => {
        console.error("Failed to send morning brief web push", err);
      });
    }
    await flushLangfuse();

    return NextResponse.json({
      ok: true,
      briefId: saved.id,
    });
  } catch (error: any) {
    console.error("Failed to generate morning brief:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}
