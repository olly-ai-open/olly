import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!)
    );
  }

  try {
    await prisma.integration.deleteMany({
      where: {
        userId: session.user.id,
        provider: "jira",
      },
    });

    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!)
    );
  } catch (error: any) {
    console.error("Failed to disconnect Jira:", error);
    return NextResponse.redirect(
      new URL("/integrations?jira_error=disconnect_failed", process.env.NEXTAUTH_URL!)
    );
  }
}