import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveCredential } from "@/lib/credentials";

/**
 * Connect Notion via a user-provided internal integration token.
 *
 * Mirrors the Airtable flow: the user pastes the integration secret from
 * notion.so/my-integrations, we validate it against the Notion API, and store
 * it per-user in the encrypted Credential table (where briefs read it).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!),
    );
  }

  try {
    const formData = await req.formData();
    const accessToken = ((formData.get("accessToken") as string) || "").trim();

    if (!accessToken) {
      return NextResponse.redirect(
        new URL("/integrations?notion_error=no_token", process.env.NEXTAUTH_URL!),
      );
    }

    // Validate the token by calling the Notion API as the integration's bot.
    const resp = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!resp.ok) {
      return NextResponse.redirect(
        new URL(
          "/integrations?notion_error=invalid_token",
          process.env.NEXTAUTH_URL!,
        ),
      );
    }

    const me = await resp.json().catch(() => null);
    const workspaceName: string = me?.bot?.workspace_name || me?.name || "";

    await saveCredential(session.user.id, "notion", {
      accessToken,
      workspaceName,
    });

    return NextResponse.redirect(
      new URL("/integrations?notion_connected=true", process.env.NEXTAUTH_URL!),
    );
  } catch (error) {
    console.error("Failed to connect Notion:", error);
    return NextResponse.redirect(
      new URL(
        "/integrations?notion_error=connect_failed",
        process.env.NEXTAUTH_URL!,
      ),
    );
  }
}
