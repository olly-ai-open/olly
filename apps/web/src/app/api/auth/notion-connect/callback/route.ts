import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/notion";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings?notion_error=${error}`, req.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?notion_error=no_code", req.url)
    );
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    // Store tokenData in database associated with user
    // For now, redirect with success
    return NextResponse.redirect(
      new URL("/settings?notion_connected=true", req.url)
    );
  } catch (error: any) {
    console.error("Failed to exchange Notion code:", error);
    return NextResponse.redirect(
      new URL(`/settings?notion_error=${error.message}", req.url)
    );
  }
}
