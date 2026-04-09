import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const [account, notionCredential, airtableCredential, jiraIntegration, slackAccount] =
      await Promise.all([
        prisma.account.findFirst({
          where: { userId, provider: "google" },
          select: { scope: true },
        }),
        prisma.notionCredential.findUnique({ where: { userId } }),
        prisma.airtableCredential.findUnique({ where: { userId } }),
        prisma.integration.findFirst({
          where: { userId, provider: "jira", status: "connected" },
        }),
        prisma.account.findFirst({
          where: { userId, provider: "slack" },
          select: { access_token: true },
        }),
      ]);

    const scope = account?.scope || "";

    return NextResponse.json({
      notion: !!notionCredential,
      airtable: !!airtableCredential,
      jira: !!jiraIntegration,
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