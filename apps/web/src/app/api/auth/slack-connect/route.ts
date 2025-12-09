import { auth } from "@/lib/auth";
import { buildSlackAuthorizeUrl } from "@/lib/slack";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = buildSlackAuthorizeUrl(session.user.id);
    return NextResponse.redirect(url);
  } catch (error: any) {
    console.error("Failed to start Slack OAuth:", error);
    return NextResponse.json(
      { error: error?.message || "slack_oauth_error" },
      { status: 500 },
    );
  }
}
