import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!),
    );
  }

  try {
    // Delete Notion credentials from database
    await prisma.notionCredential.delete({
      where: { userId: session.user.id },
    });

    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!),
    );
  } catch (error: any) {
    console.error("Failed to disconnect Notion:", error);
    return NextResponse.redirect(
      new URL(
        "/integrations?notion_error=disconnect_failed",
        process.env.NEXTAUTH_URL!,
      ),
    );
  }
}
