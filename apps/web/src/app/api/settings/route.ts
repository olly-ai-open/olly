import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { defaultTimeZone } from "@olly/core";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function ensureUserExists(userId: string) {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
    },
  });
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const userId = session.user.id;

    await ensureUserExists(userId);

    let settings = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          userId,
          searchTimeframeDays: 30,
          briefSystemPrompt: null,
          queryPlannerSystemPrompt: null,
          morningBriefSystemPrompt: null,
          endOfDayBriefSystemPrompt: null,
          timeZone: null,
          telemetryOptIn: true,
          emailNotifications: true,
          webNotificationsEnabled: false,
          ignoredEventPatterns: [],
        },
      });
    }

    return NextResponse.json({
      ...settings,
      timeZone: settings.timeZone ?? defaultTimeZone(),
      // True when the user never chose a zone and the value above is the
      // server's fallback. The dashboard uses this to save the browser's
      // zone once, so hosted users get local times without visiting Settings.
      timeZoneIsDefault: settings.timeZone == null,
    });
  } catch (error) {
    console.error("Failed to get user settings:", error);
    return NextResponse.json(
      { error: "failed_to_get_settings" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    let briefSystemPrompt: string | null | undefined;
    let queryPlannerSystemPrompt: string | null | undefined;
    let morningBriefSystemPrompt: string | null | undefined;
    let endOfDayBriefSystemPrompt: string | null | undefined;
    let ignoredEventPatterns: Prisma.InputJsonValue | undefined;

    const body = await req.json();

    const {
      searchTimeframeDays,
      emailNotifications,
      webNotificationsEnabled,
      briefSystemPrompt: rawBriefSystemPrompt,
      queryPlannerSystemPrompt: rawQueryPlannerSystemPrompt,
      morningBriefSystemPrompt: rawMorningBriefSystemPrompt,
      endOfDayBriefSystemPrompt: rawEndOfDayBriefSystemPrompt,
      timeZone,
      telemetryOptIn,
      workingHoursStart,
      workingHoursEnd,
      workingDays,
      meetingBufferMinutes,
      minSchedulingNoticeHours,
      meetingBriefLeadMinutes,
    } = body;

    const isValidTimeOfDay = (value: unknown) =>
      typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

    for (const [key, value] of [
      ["workingHoursStart", workingHoursStart],
      ["workingHoursEnd", workingHoursEnd],
    ] as const) {
      if (value !== undefined && value !== null && !isValidTimeOfDay(value)) {
        return NextResponse.json(
          { error: `${key} must be HH:MM (24h) or null` },
          { status: 400 },
        );
      }
    }

    if (
      workingDays !== undefined &&
      (!Array.isArray(workingDays) ||
        workingDays.some(
          (d: unknown) => typeof d !== "number" || d < 1 || d > 7,
        ))
    ) {
      return NextResponse.json(
        { error: "workingDays must be an array of ISO weekday numbers (1-7)" },
        { status: 400 },
      );
    }

    if (
      meetingBufferMinutes !== undefined &&
      (typeof meetingBufferMinutes !== "number" ||
        meetingBufferMinutes < 0 ||
        meetingBufferMinutes > 120)
    ) {
      return NextResponse.json(
        { error: "meetingBufferMinutes must be between 0 and 120" },
        { status: 400 },
      );
    }

    if (
      meetingBriefLeadMinutes !== undefined &&
      (typeof meetingBriefLeadMinutes !== "number" ||
        !Number.isInteger(meetingBriefLeadMinutes) ||
        meetingBriefLeadMinutes < 1 ||
        meetingBriefLeadMinutes > 120)
    ) {
      return NextResponse.json(
        { error: "meetingBriefLeadMinutes must be a whole number between 1 and 120" },
        { status: 400 },
      );
    }

    if (
      minSchedulingNoticeHours !== undefined &&
      (typeof minSchedulingNoticeHours !== "number" ||
        minSchedulingNoticeHours < 0 ||
        minSchedulingNoticeHours > 336)
    ) {
      return NextResponse.json(
        { error: "minSchedulingNoticeHours must be between 0 and 336" },
        { status: 400 },
      );
    }

    if (
      searchTimeframeDays !== undefined &&
      (typeof searchTimeframeDays !== "number" ||
        searchTimeframeDays < 1 ||
        searchTimeframeDays > 180)
    ) {
      return NextResponse.json(
        { error: "searchTimeframeDays must be between 1 and 180" },
        { status: 400 },
      );
    }

    if (
      emailNotifications !== undefined &&
      typeof emailNotifications !== "boolean"
    ) {
      return NextResponse.json(
        { error: "emailNotifications must be a boolean" },
        { status: 400 },
      );
    }

    if (
      webNotificationsEnabled !== undefined &&
      typeof webNotificationsEnabled !== "boolean"
    ) {
      return NextResponse.json(
        { error: "webNotificationsEnabled must be a boolean" },
        { status: 400 },
      );
    }

    if (telemetryOptIn !== undefined && typeof telemetryOptIn !== "boolean") {
      return NextResponse.json(
        { error: "telemetryOptIn must be a boolean" },
        { status: 400 },
      );
    }

    let cachedUser: { isAdmin: boolean } | null = null;

    const isAdmin = async (id: string) => {
      if (!cachedUser) {
        cachedUser = await prisma.user.findUnique({
          where: { id },
          select: { isAdmin: true },
        });
      }
      return !!cachedUser?.isAdmin;
    };

    if (
      rawBriefSystemPrompt !== undefined ||
      rawQueryPlannerSystemPrompt !== undefined ||
      rawMorningBriefSystemPrompt !== undefined ||
      rawEndOfDayBriefSystemPrompt !== undefined
    ) {
      if (!(await isAdmin(userId))) {
        return NextResponse.json(
          { error: "forbidden: prompt overrides are admin-only" },
          { status: 403 },
        );
      }

      if (rawBriefSystemPrompt !== undefined) {
        const value =
          typeof rawBriefSystemPrompt === "string"
            ? rawBriefSystemPrompt.trim()
            : "";
        briefSystemPrompt = value.length ? value : null;
      }

      if (rawQueryPlannerSystemPrompt !== undefined) {
        const value =
          typeof rawQueryPlannerSystemPrompt === "string"
            ? rawQueryPlannerSystemPrompt.trim()
            : "";
        queryPlannerSystemPrompt = value.length ? value : null;
      }

      if (rawMorningBriefSystemPrompt !== undefined) {
        const value =
          typeof rawMorningBriefSystemPrompt === "string"
            ? rawMorningBriefSystemPrompt.trim()
            : "";
        morningBriefSystemPrompt = value.length ? value : null;
      }

      if (rawEndOfDayBriefSystemPrompt !== undefined) {
        const value =
          typeof rawEndOfDayBriefSystemPrompt === "string"
            ? rawEndOfDayBriefSystemPrompt.trim()
            : "";
        endOfDayBriefSystemPrompt = value.length ? value : null;
      }
    }

    if (timeZone != null) {
      if (typeof timeZone !== "string") {
        return NextResponse.json(
          { error: "timeZone must be a string or null" },
          { status: 400 },
        );
      }

      const trimmed = timeZone.trim();
      if (trimmed) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
        } catch {
          return NextResponse.json(
            {
              error:
                "timeZone must be a valid IANA time zone (e.g. America/Los_Angeles)",
            },
            { status: 400 },
          );
        }
      }
    }

    if (Array.isArray(body?.ignoredEventPatterns)) {
      ignoredEventPatterns =
        body.ignoredEventPatterns as Prisma.InputJsonValue;
    } else if (body?.ignoredEventPatterns === null) {
      ignoredEventPatterns = [];
    } else if (body?.ignoredEventPatterns !== undefined) {
      return NextResponse.json(
        {
          error:
            "ignoredEventPatterns must be an array of strings or pattern objects",
        },
        { status: 400 },
      );
    }

    await ensureUserExists(userId);

    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: {
        ...(searchTimeframeDays !== undefined && { searchTimeframeDays }),
        ...(emailNotifications !== undefined && { emailNotifications }),
        ...(webNotificationsEnabled !== undefined && {
          webNotificationsEnabled,
        }),
        ...(telemetryOptIn !== undefined && { telemetryOptIn }),
        ...(briefSystemPrompt !== undefined && { briefSystemPrompt }),
        ...(queryPlannerSystemPrompt !== undefined && {
          queryPlannerSystemPrompt,
        }),
        ...(morningBriefSystemPrompt !== undefined && {
          morningBriefSystemPrompt,
        }),
        ...(endOfDayBriefSystemPrompt !== undefined && {
          endOfDayBriefSystemPrompt,
        }),
        ...(timeZone !== undefined && {
          timeZone: timeZone === null ? null : timeZone.trim() || null,
        }),
        ...(ignoredEventPatterns !== undefined && { ignoredEventPatterns }),
        ...(workingHoursStart !== undefined && { workingHoursStart }),
        ...(workingHoursEnd !== undefined && { workingHoursEnd }),
        ...(workingDays !== undefined && { workingDays }),
        ...(meetingBufferMinutes !== undefined && { meetingBufferMinutes }),
        ...(minSchedulingNoticeHours !== undefined && {
          minSchedulingNoticeHours,
        }),
        ...(meetingBriefLeadMinutes !== undefined && {
          meetingBriefLeadMinutes,
        }),
      },
      create: {
        userId,
        searchTimeframeDays: searchTimeframeDays ?? 30,
        briefSystemPrompt: briefSystemPrompt ?? null,
        queryPlannerSystemPrompt: queryPlannerSystemPrompt ?? null,
        morningBriefSystemPrompt: morningBriefSystemPrompt ?? null,
        endOfDayBriefSystemPrompt: endOfDayBriefSystemPrompt ?? null,
        timeZone: timeZone == null ? null : timeZone.trim() || null,
        emailNotifications: emailNotifications ?? true,
        webNotificationsEnabled: webNotificationsEnabled ?? false,
        telemetryOptIn: telemetryOptIn ?? true,
        ignoredEventPatterns: ignoredEventPatterns ?? [],
        workingHoursStart: workingHoursStart ?? null,
        workingHoursEnd: workingHoursEnd ?? null,
        workingDays: workingDays ?? [1, 2, 3, 4, 5],
        meetingBufferMinutes: meetingBufferMinutes ?? 0,
        meetingBriefLeadMinutes: meetingBriefLeadMinutes ?? 5,
        minSchedulingNoticeHours: minSchedulingNoticeHours ?? 24,
      },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to update user settings:", error);
    return NextResponse.json(
      { error: "failed_to_update_settings" },
      { status: 500 },
    );
  }
}