import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/settings - Get user settings
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    let settings = await prisma.userSettings.findUnique({
      where: { userId: session.user.id },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          userId: session.user.id,
          searchTimeframeDays: 30,
          searchStrategy: null,
          briefSystemPrompt: null,
          queryPlannerSystemPrompt: null,
          emailNotifications: true,
        },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to get user settings:", error);
    return NextResponse.json(
      { error: "failed_to_get_settings" },
      { status: 500 },
    );
  }
}

// PUT /api/settings - Update user settings
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const body = await req.json();
    const {
      searchTimeframeDays,
      emailNotifications,
      searchStrategy,
      briefSystemPrompt,
      queryPlannerSystemPrompt,
      timeZone,
    } = body;

    // Validate searchTimeframeDays
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

    // Validate emailNotifications
    if (
      emailNotifications !== undefined &&
      typeof emailNotifications !== "boolean"
    ) {
      return NextResponse.json(
        { error: "emailNotifications must be a boolean" },
        { status: 400 },
      );
    }

    // Validate admin-only fields (searchStrategy + prompt overrides)
    let nextSearchStrategy: string | undefined;
    let nextBriefSystemPrompt: string | null | undefined;
    let nextQueryPlannerSystemPrompt: string | null | undefined;
    let adminUser: { isAdmin: boolean } | null = null;

    const ensureAdmin = async (uid: string) => {
      if (!adminUser) {
        adminUser = await prisma.user.findUnique({
          where: { id: uid },
          select: { isAdmin: true },
        });
      }
      return !!adminUser?.isAdmin;
    };

    if (searchStrategy !== undefined) {
      const allowed = ["LLM_ONLY", "HEURISTIC_ONLY", "LLM_AND_HEURISTIC"];
      if (!allowed.includes(searchStrategy)) {
        return NextResponse.json(
          {
            error:
              "searchStrategy must be one of LLM_ONLY, HEURISTIC_ONLY, LLM_AND_HEURISTIC",
          },
          { status: 400 },
        );
      }

      if (!(await ensureAdmin(userId))) {
        return NextResponse.json(
          { error: "forbidden: searchStrategy is admin-only" },
          { status: 403 },
        );
      }

      nextSearchStrategy = searchStrategy;
    }

    if (
      briefSystemPrompt !== undefined ||
      queryPlannerSystemPrompt !== undefined
    ) {
      if (!(await ensureAdmin(userId))) {
        return NextResponse.json(
          { error: "forbidden: prompt overrides are admin-only" },
          { status: 403 },
        );
      }

      if (briefSystemPrompt !== undefined) {
        const v =
          typeof briefSystemPrompt === "string" ? briefSystemPrompt.trim() : "";
        nextBriefSystemPrompt = v.length ? v : null;
      }
      if (queryPlannerSystemPrompt !== undefined) {
        const v =
          typeof queryPlannerSystemPrompt === "string"
            ? queryPlannerSystemPrompt.trim()
            : "";
        nextQueryPlannerSystemPrompt = v.length ? v : null;
      }
    }

    // Validate timeZone (user-level)
    if (timeZone !== undefined && timeZone !== null) {
      if (typeof timeZone !== "string") {
        return NextResponse.json(
          { error: "timeZone must be a string or null" },
          { status: 400 },
        );
      }
      const trimmed = timeZone.trim();
      if (trimmed) {
        try {
          // Validate that the timezone identifier is understood by Intl
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

    const settings = await prisma.userSettings.upsert({
      where: { userId: session.user.id },
      update: {
        ...(searchTimeframeDays !== undefined && { searchTimeframeDays }),
        ...(emailNotifications !== undefined && { emailNotifications }),
        ...(nextSearchStrategy !== undefined && {
          searchStrategy: nextSearchStrategy,
        }),
        ...(nextBriefSystemPrompt !== undefined && {
          briefSystemPrompt: nextBriefSystemPrompt,
        }),
        ...(nextQueryPlannerSystemPrompt !== undefined && {
          queryPlannerSystemPrompt: nextQueryPlannerSystemPrompt,
        }),
        ...(timeZone !== undefined && {
          timeZone: timeZone === null ? null : timeZone.trim() || null,
        }),
      },
      create: {
        userId: session.user.id,
        searchTimeframeDays: searchTimeframeDays ?? 30,
        searchStrategy: nextSearchStrategy ?? null,
        briefSystemPrompt: nextBriefSystemPrompt ?? null,
        queryPlannerSystemPrompt: nextQueryPlannerSystemPrompt ?? null,
        timeZone:
          timeZone === undefined || timeZone === null
            ? null
            : timeZone.trim() || null,
        emailNotifications: emailNotifications ?? true,
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
