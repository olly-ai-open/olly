import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasCredential } from "@/lib/credentials";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const [account, notionConnected, airtableConnected, jiraConnected, slackAccount] =
      await Promise.all([
        prisma.account.findFirst({
          where: { userId, provider: "google" },
          select: { scope: true },
        }),
        hasCredential(userId, "notion"),
        hasCredential(userId, "airtable"),
        hasCredential(userId, "jira"),
        prisma.account.findFirst({
          where: { userId, provider: "slack" },
          select: { access_token: true },
        }),
      ]);

    const scope = account?.scope || "";

    return NextResponse.json({
      notion: notionConnected,
      airtable: airtableConnected,
      jira: jiraConnected,
      slack: !!slackAccount?.access_token,
      gmail: scope.includes("gmail"),
      google_drive: scope.includes("drive"),
      google_docs: scope.includes("drive"),
    });
  } catch {
    return NextResponse.json({
      notion: false,
      airtable: false,
      jira: false,
      slack: false,
      gmail: false,
      google_drive: false,
      google_docs: false,
    });
  }
}