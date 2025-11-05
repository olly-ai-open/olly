import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Update the Integration record to mark as disconnected
    await prisma.integration.updateMany({
      where: {
        userId: session.user.id,
        provider: "google_workspace",
      },
      data: {
        status: "disconnected",
        scopes: null,
        meta: {
          disconnectedAt: new Date().toISOString(),
          hasAdvancedScopes: false,
        },
        updatedAt: new Date(),
      },
    });

    // Update account to remove advanced scopes but keep basic auth
    await prisma.account.updateMany({
      where: {
        userId: session.user.id,
        provider: "google",
      },
      data: {
        scope: "openid email profile", // Reset to basic scopes only
        access_token: null, // Clear tokens for advanced scopes
        refresh_token: null,
      },
    });

    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?success=google_disconnected`,
    );
  } catch (error) {
    console.error("Error disconnecting Google account:", error);
    return NextResponse.json(
      { error: "Failed to disconnect Google account" },
      { status: 500 },
    );
  }
}
