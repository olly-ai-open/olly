import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { driveAccess } = await request.json();

    if (!["full", "folders"].includes(driveAccess)) {
      return NextResponse.json(
        { error: "Invalid drive access value" },
        { status: 400 },
      );
    }

    // Get existing integration to preserve other meta data
    const existingIntegration = await prisma.integration.findFirst({
      where: {
        userId: session.user.id,
        provider: "google_workspace",
      },
      select: { id: true, meta: true },
    });

    if (!existingIntegration) {
      return NextResponse.json(
        { error: "Google integration not found" },
        { status: 404 },
      );
    }

    // Merge with existing meta data
    const updatedMeta = {
      ...((existingIntegration.meta as any) || {}),
      driveAccess,
    };

    // Update the integration with merged meta
    await prisma.integration.update({
      where: { id: existingIntegration.id },
      data: { meta: updatedMeta },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating drive access:", error);
    return NextResponse.json(
      { error: "Failed to update drive access" },
      { status: 500 },
    );
  }
}
