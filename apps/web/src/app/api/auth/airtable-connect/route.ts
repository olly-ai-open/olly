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

    if (!accessToken) {
      return NextResponse.redirect(
        new URL("/integrations?airtable_error=no_token", process.env.NEXTAUTH_URL!)
      );
    }

    const resp = await fetch("https://api.airtable.com/v0/meta/bases", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      return NextResponse.redirect(
        new URL("/integrations?airtable_error=invalid_token", process.env.NEXTAUTH_URL!)
      );
    }

    await saveCredential(session.user.id, "airtable", { accessToken });

    return NextResponse.redirect(
      new URL("/integrations?airtable_connected=true", process.env.NEXTAUTH_URL!)
    );
  } catch (error: any) {
    console.error("Failed to connect Airtable:", error);
    return NextResponse.redirect(
      new URL("/integrations?airtable_error=connect_failed", process.env.NEXTAUTH_URL!)
    );
  }
}