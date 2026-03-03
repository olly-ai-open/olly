import { auth } from "@/lib/auth";
import { buildNotionAuthorizeUrl } from "@/lib/notion";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = buildNotionAuthorizeUrl(session.user.id);
    return NextResponse.redirect(url);
  } catch (error: any) {
    console.error("Failed to start Notion OAuth:", error);
    return NextResponse.json({ error: error?.message || "notion_oauth_error" }, { status: 500 });
  }
}
