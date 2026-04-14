import { auth } from "@/lib/auth";
import { deleteCredential } from "@/lib/credentials";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!)
    );
  }

  try {
    await deleteCredential(session.user.id, "jira");

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