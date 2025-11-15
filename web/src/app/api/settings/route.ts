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
    const { searchTimeframeDays, emailNotifications } = body;

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

    const settings = await prisma.userSettings.upsert({
      where: { userId: session.user.id },
      update: {
        ...(searchTimeframeDays !== undefined && { searchTimeframeDays }),
        ...(emailNotifications !== undefined && { emailNotifications }),
      },
      create: {
        userId: session.user.id,
        searchTimeframeDays: searchTimeframeDays ?? 30,
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
