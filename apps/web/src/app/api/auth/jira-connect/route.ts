import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveCredential } from "@/lib/credentials";

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.redirect(
      new URL("/integrations", process.env.NEXTAUTH_URL!)
    );
  }

  try {
    const formData = await req.formData();
    const accessToken = formData.get("accessToken") as string;
    const baseUrl = formData.get("baseUrl") as string;
    const email = formData.get("email") as string;

    if (!accessToken || !baseUrl || !email) {
      return NextResponse.redirect(
        new URL("/integrations?jira_error=missing_fields", process.env.NEXTAUTH_URL!)
      );
    }

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const encoded = Buffer.from(`${email}:${accessToken}`).toString("base64");
    const resp = await fetch(`${cleanBaseUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${encoded}` },
    });

    if (!resp.ok) {
      return NextResponse.redirect(
        new URL("/integrations?jira_error=invalid_credentials", process.env.NEXTAUTH_URL!)
      );
    }

    await saveCredential(session.user.id, "jira", {
      accessToken,
      baseUrl: cleanBaseUrl,
      email,
    });

    return NextResponse.redirect(
      new URL("/integrations?jira_connected=true", process.env.NEXTAUTH_URL!)
    );
  } catch (error: any) {
    console.error("Failed to connect Jira:", error);
    return NextResponse.redirect(
      new URL("/integrations?jira_error=connect_failed", process.env.NEXTAUTH_URL!)
    );
  }
}