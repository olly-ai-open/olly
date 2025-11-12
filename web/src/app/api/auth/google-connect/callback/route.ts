import { auth } from "@/lib/auth";
import { getOAuthClient } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const session = await auth();
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // User ID passed from the auth request
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=google_connect_denied`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=invalid_request`,
    );
  }

  // Verify the user ID matches the session
  if (!session?.user?.id || session.user.id !== state) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=unauthorized`,
    );
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/google-connect/callback`;
    const oAuth2Client = getOAuthClient(redirectUri);

    // Exchange code for tokens
    const { tokens } = await oAuth2Client.getToken({
      code,
      redirect_uri: redirectUri,
    });

    // Get user info to get the Google account ID
    oAuth2Client.setCredentials(tokens);

    // Since the user is already authenticated, we can get their existing account
    // to get the Google account ID (providerAccountId)
    const existingAccount = await prisma.account.findFirst({
      where: {
        userId: session.user.id,
        provider: "google",
      },
    });

    // If no existing account, we need to get the Google ID from the ID token
    let googleAccountId: string;
    if (existingAccount) {
      googleAccountId = existingAccount.providerAccountId;
    } else if (tokens.id_token) {
      // Decode the ID token to get the Google user ID
      const idTokenPayload = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64").toString(),
      );
      googleAccountId = idTokenPayload.sub;
    } else {
      // Fallback: Try to get user info from Google
      const response = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to get user info:", response.status, errorText);
        throw new Error(`Failed to get user info: ${response.status}`);
      }

      const userInfo = await response.json();
      googleAccountId = userInfo.sub;
    }

    // Since user should already be signed in with basic scopes,
    // we're adding the advanced scopes to their existing account
    if (existingAccount) {
      // Merge scopes: keep existing basic scopes and add new advanced scopes
      const existingScopes = existingAccount.scope || "openid email profile";
      const newScopes = tokens.scope || "";
      const allScopes = Array.from(
        new Set([...existingScopes.split(" "), ...newScopes.split(" ")]),
      ).join(" ");

      await prisma.account.update({
        where: {
          id: existingAccount.id,
        },
        data: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || existingAccount.refresh_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : existingAccount.expires_at,
          token_type: tokens.token_type || existingAccount.token_type,
          scope: allScopes,
          id_token: tokens.id_token || existingAccount.id_token,
        },
      });
    } else {
      // This shouldn't happen if user is signed in, but handle it just in case
      await prisma.account.create({
        data: {
          userId: session.user.id,
          type: "oauth",
          provider: "google",
          providerAccountId: googleAccountId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : undefined,
          token_type: tokens.token_type,
          scope: tokens.scope,
          id_token: tokens.id_token,
        },
      });
    }

    // Update the Integration record to track advanced connection
    await prisma.integration.upsert({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "google_workspace",
        },
      },
      update: {
        scopes: tokens.scope,
        status: "connected",
        meta: {
          connectedAt: new Date().toISOString(),
          hasAdvancedScopes: true,
        },
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        provider: "google_workspace",
        scopes: tokens.scope,
        status: "connected",
        meta: {
          connectedAt: new Date().toISOString(),
          hasAdvancedScopes: true,
        },
      },
    });

    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?success=google_connected`,
    );
  } catch (error: any) {
    console.error("Error connecting Google account:", {
      message: error.message,
      stack: error.stack,
      error,
    });
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=connection_failed&details=${encodeURIComponent(error.message || "Unknown error")}`,
    );
  }
}
