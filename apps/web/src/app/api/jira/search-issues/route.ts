import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getJiraCredentials } from "@/lib/jira";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { description, projectKey, dateRangeDays = 30 } = body;

    const credentials = await getJiraCredentials(session.user.id);

    if (!credentials) {
      return NextResponse.json({ issues: [] });
    }

    const encoded = Buffer.from(
      `${credentials.email}:${credentials.accessToken}`
    ).toString("base64");

    const keywords = description
      .split(" ")
      .filter((w: string) => w.length > 3)
      .slice(0, 5)
      .map((w: string) => w.replace(/[\\"\[\]{}^~*?:|&]/g, " ").trim())
      .filter(Boolean)
      .join(" ");

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - dateRangeDays);
    const sinceDateStr = sinceDate.toISOString().split("T")[0];

    const jql = projectKey
      ? `project = "${projectKey}" AND text ~ "${keywords}" AND created >= "${sinceDateStr}" ORDER BY created DESC`
      : `text ~ "${keywords}" AND created >= "${sinceDateStr}" ORDER BY created DESC`;

    const url = `${credentials.baseUrl}/rest/api/3/search/jql`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        maxResults: 5,
        fields: ["summary", "status", "created", "creator", "assignee"],
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("[Jira] search-issues error:", resp.status, errorText);
      return NextResponse.json({ issues: [], error: `Jira search failed: ${resp.status}` });
    }

    const data = await resp.json();
    const issues = data.issues?.map((i: any) => ({
      key: i.key,
      summary: i.fields?.summary,
      status: i.fields?.status?.name,
      created: i.fields?.created,
      creator: i.fields?.creator?.displayName,
      url: `${credentials.baseUrl}/browse/${i.key}`,
    })) || [];

    return NextResponse.json({ issues });
  } catch (error: any) {
    console.error("[Jira] search-issues exception:", error?.message || error);
    return NextResponse.json({ issues: [], error: error?.message || "search_failed" }, { status: 500 });
  }
}