import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getJiraCredentials } from "@/lib/jira";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const credentials = await getJiraCredentials(session.user.id);

    if (!credentials) {
      return NextResponse.json({ projects: [] });
    }

    const encoded = Buffer.from(
      `${credentials.email}:${credentials.accessToken}`
    ).toString("base64");

    const resp = await fetch(`${credentials.baseUrl}/rest/api/3/project`, {
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      return NextResponse.json({ projects: [] });
    }

    const data = await resp.json();
    const projects = data.map((p: any) => ({
      key: p.key,
      name: p.name,
    }));

    return NextResponse.json({ projects });
  } catch (error: any) {
    console.error("[Jira] Failed to fetch projects:", error);
    return NextResponse.json({ projects: [] });
  }
}