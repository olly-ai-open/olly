import { auth } from "@/lib/auth";
import { getOAuthClient } from "@/lib/google";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/google-connect/callback`;
  const oAuth2Client = getOAuthClient(redirectUri);

  // Advanced scopes for calendar, drive, and gmail
  const scopes = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/drive.readonly", // Needed for Google Picker to browse all folders
    "https://www.googleapis.com/auth/drive.file", // Needed to maintain access to selected folders
    "https://www.googleapis.com/auth/gmail.readonly",
  ];

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state: session.user.id, // Pass user ID as state to link account after callback
  });

  console.log("Generated auth URL with redirect_uri:", redirectUri);

  return NextResponse.redirect(authUrl);
}
