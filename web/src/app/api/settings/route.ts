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

  try {
    const body = await req.json();
    const { searchTimeframeDays, emailNotifications, searchStrategy } = body;

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

    // Validate searchStrategy (admin-only)
    let nextSearchStrategy: string | undefined;
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

      // Only admins can change searchStrategy
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { isAdmin: true },
      });
      if (!user?.isAdmin) {
        return NextResponse.json(
          { error: "forbidden: searchStrategy is admin-only" },
          { status: 403 },
        );
      }

      nextSearchStrategy = searchStrategy;
    }

    const settings = await prisma.userSettings.upsert({
      where: { userId: session.user.id },
      update: {
        ...(searchTimeframeDays !== undefined && { searchTimeframeDays }),
        ...(emailNotifications !== undefined && { emailNotifications }),
        ...(nextSearchStrategy !== undefined && {
          searchStrategy: nextSearchStrategy,
        }),
      },
      create: {
        userId: session.user.id,
        searchTimeframeDays: searchTimeframeDays ?? 30,
        searchStrategy: nextSearchStrategy ?? null,
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
