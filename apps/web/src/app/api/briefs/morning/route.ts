import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAccessTokenFromAccount,
  listEventsByDayWithToken,
} from "@/lib/google";
import { getUserSettings } from "@/lib/settings";
import { didUserDeclineEvent, sendBriefReadyWebPush } from "@olly/core";
import { flushLangfuse } from "@olly/core/src/telemetry/langfuse";
import { MorningBriefAgent } from "@olly/core/src/agents/personas/MorningBriefAgent";
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

function getFriendlyLLMError(error: any): {
  code: string;
  message: string;
  status: number;
} | null {
  const message = String(error?.message || "");
  const responseBody = String(error?.responseBody || "");
  const combined = `${message}\n${responseBody}`;

  if (
    combined.includes("Your credit balance is too low") ||
    combined.includes("Plans & Billing")
  ) {
    return {
      code: "llm_billing",
      message:
        "Morning brief is temporarily unavailable because the configured Anthropic API account has no credits. Add credits or switch providers in settings.",
      status: 503,
    };
  }

  if (
    combined.includes("invalid x-api-key") ||
    combined.includes("authentication_error") ||
    combined.includes("ANTHROPIC_API_KEY not configured") ||
    combined.includes("OPENAI_API_KEY not configured") ||
    combined.includes("GEMINI_API_KEY not configured")
  ) {
    return {
      code: "llm_auth",
      message:
        "Morning brief is temporarily unavailable because the LLM API key is missing or invalid. Update the provider credentials in settings.",
      status: 503,
    };
  }

  if (
    combined.includes("insufficient_quota") ||
    combined.includes("You exceeded your current quota")
  ) {
    return {
      code: "llm_quota",
      message:
        "Morning brief is temporarily unavailable because the configured LLM account has no remaining quota. Update billing or switch providers in settings.",
      status: 503,
    };
  }

  return null;
}

export async function POST(req: Request) {
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

    let rawBrief: string;
    try {
      const agent = new MorningBriefAgent({
        telemetryEnabled: settings.telemetryOptIn !== false,
      });

      rawBrief = await agent.generateMorningBrief(userId, {
        date: dayISO,
        timeZone,
        actionItems: actionItemsForBrief,
      });
    } catch (error: any) {
      await flushLangfuse().catch(() => {});
      const friendly = getFriendlyLLMError(error);

      if (friendly) {
        console.error("Morning brief LLM error:", error);
        return NextResponse.json(
          {
            ok: false,
            error: friendly.code,
            message: friendly.message,
          },
          { status: friendly.status },
        );
      }

      throw error;
    }

    const parsed = safeParseMorningBriefJSON(rawBrief);
    const morning: MorningBriefJSON = parsed ?? {
      brief_markdown: rawBrief,
      highlighted_action_item_ids: [],
    };

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

    const saved = await prisma.brief.create({
      data: {
        meetingId: morningMeeting.id,
        content: {
          brief_markdown: morning.brief_markdown,
          highlighted_action_item_ids: morning.highlighted_action_item_ids,
        },
        confidence,
        sources: formattedSources,
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
    await flushLangfuse().catch(() => {});
    console.error("Failed to generate morning brief:", error);

    const friendly = getFriendlyLLMError(error);
    if (friendly) {
      return NextResponse.json(
        {
          ok: false,
          error: friendly.code,
          message: friendly.message,
        },
        { status: friendly.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "failed",
        message: "Morning brief generation failed.",
      },
      { status: 500 },
    );
  }
}