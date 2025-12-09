import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.integration.updateMany({
      where: {
        userId: session.user.id,
        provider: "slack",
      },
      data: {
        status: "disconnected",
        scopes: null,
        meta: {
          disconnectedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      },
    });

    await prisma.account.updateMany({
      where: {
        userId: session.user.id,
        provider: "slack",
      },
      data: {
        access_token: null,
        refresh_token: null,
        expires_at: null,
        scope: null,
      },
    });

    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?success=slack_disconnected`,
    );
  } catch (error) {
    console.error("Error disconnecting Slack:", error);
    return NextResponse.json(
      { error: "Failed to disconnect Slack" },
      { status: 500 },
    );
  }
}
