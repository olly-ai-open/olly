import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WorkspaceSearchCore } from "@olly/core";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const query = typeof body?.query === "string" ? body.query : "";
  const maxResults =
    typeof body?.maxResults === "number" && body.maxResults > 0
      ? Math.min(body.maxResults, 20)
      : 10;
  const windowStart =
    typeof body?.windowStart === "string" && body.windowStart
      ? new Date(body.windowStart)
      : undefined;
  const windowEnd =
    typeof body?.windowEnd === "string" && body.windowEnd
      ? new Date(body.windowEnd)
      : undefined;

  if (!query.trim()) {
    return NextResponse.json({ messages: [] });
  }

  try {
    const search = new WorkspaceSearchCore(prisma, session.user.id);
    const messages = await search.searchSlack(query, {
      maxResults,
      windowStart:
        windowStart && !Number.isNaN(windowStart.getTime())
          ? windowStart
          : undefined,
      windowEnd:
        windowEnd && !Number.isNaN(windowEnd.getTime()) ? windowEnd : undefined,
    });
    return NextResponse.json({ messages });
  } catch (err: any) {
    console.error("Slack search failed", err);
    const status = err?.message === "no_slack_account" ? 404 : 500;
    return NextResponse.json(
      { error: err?.message || "slack_search_failed" },
      { status },
    );
  }
}
