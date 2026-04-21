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
    const { summary, description, projectKey, issueType } = body;

    if (!summary || !projectKey) {
      return NextResponse.json(
        { error: "summary and projectKey are required" },
        { status: 400 }
      );
    }

    const credentials = await getJiraCredentials(session.user.id);

    if (!credentials) {
      return NextResponse.json(
        { error: "Jira not connected" },
        { status: 400 }
      );
    }

    console.log('[Jira] Creating issue:', { summary, projectKey, issueType });
    console.log('[Jira] Using baseUrl:', credentials.baseUrl);

    const encoded = Buffer.from(
      `${credentials.email}:${credentials.accessToken}`
    ).toString("base64");

    const resp = await fetch(`${credentials.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary,
          description: description
            ? {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: description }],
                  },
                ],
              }
            : undefined,
          issuetype: { name: issueType || "Task" },
        },
      }),
    });

    if (!resp.ok) {
      const error = await resp.text();
      console.log('[Jira] API error response:', resp.status, error);
      return NextResponse.json(
        { error: `Jira API error: ${error}` },
        { status: resp.status }
      );
    }

    const data = await resp.json();
    return NextResponse.json({
      success: true,
      issueKey: data.key,
      url: `${credentials.baseUrl}/browse/${data.key}`,
    });
  } catch (error: any) {
    console.error("[Jira] Failed to create issue:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create issue" },
      { status: 500 }
    );
  }
}