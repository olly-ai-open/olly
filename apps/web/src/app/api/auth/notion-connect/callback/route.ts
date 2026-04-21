import { NextRequest, NextResponse } from "next/server";
import { exchangeNotionOAuthCode } from "@/lib/notion";
import { auth } from "@/lib/auth";
import { saveCredential } from "@/lib/credentials";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/integrations?notion_error=${error}`, req.url),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/integrations?notion_error=no_code", req.url),
    );
  }

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.redirect(
        new URL("/integrations?notion_error=not_authenticated", req.url),
      );
    }

    const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/notion-connect/callback`;
    const tokenData = await exchangeNotionOAuthCode(code, redirectUri);

    await saveCredential(session.user.id, "notion", {
      accessToken: tokenData.access_token,
      workspaceId: tokenData.workspace_id,
      workspaceName: tokenData.workspace_name ?? "",
      botId: tokenData.bot_id,
    });

    return NextResponse.redirect(
      new URL("/integrations?notion_connected=true", req.url),
    );
  } catch (error: any) {
    console.error("Failed to exchange Notion code:", error);
    return NextResponse.redirect(
      new URL(`/integrations?notion_error=${error.message}`, req.url),
    );
  }
}