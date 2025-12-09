import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exchangeSlackOAuthCode, getSlackScopes } from "@/lib/slack";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=slack_connect_denied`,
    );
  }

  if (!session?.user?.id) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=unauthorized`,
    );
  }

  if (!code || !state || state !== session.user.id) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=invalid_request`,
    );
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/slack-connect/callback`;
    const oauth = await exchangeSlackOAuthCode(code, redirectUri);

    const accessToken =
      oauth.authed_user?.access_token || oauth.access_token || null;
    const refreshToken =
      oauth.authed_user?.refresh_token || oauth.refresh_token || null;
    const expiresIn = oauth.authed_user?.expires_in ?? oauth.expires_in ?? null;
    const expiresAt =
      expiresIn !== null
        ? Math.floor(Date.now() / 1000) + Number(expiresIn)
        : null;

    if (!oauth.ok || !accessToken) {
      const reason = oauth.error || "slack_oauth_failed";
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL}/integrations?error=${encodeURIComponent(reason)}`,
      );
    }

    const scopeValue =
      oauth.authed_user?.scope ?? oauth.scope ?? getSlackScopes().join(",");

    const providerAccountId =
      oauth.authed_user?.id ||
      (oauth.team?.id
        ? `${oauth.team.id}:${session.user.id}`
        : `slack:${session.user.id}`);

    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "slack",
          providerAccountId,
        },
      },
      create: {
        userId: session.user.id,
        type: "oauth",
        provider: "slack",
        providerAccountId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt ?? undefined,
        token_type: oauth.authed_user?.token_type ?? oauth.token_type ?? "user",
        scope: scopeValue,
      },
      update: {
        userId: session.user.id,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        token_type: oauth.authed_user?.token_type ?? oauth.token_type ?? "user",
        scope: scopeValue,
      },
    });

    await prisma.integration.upsert({
      where: {
        userId_provider: {
          userId: session.user.id,
          provider: "slack",
        },
      },
      update: {
        scopes: scopeValue ?? null,
        status: "connected",
        meta: {
          connectedAt: new Date().toISOString(),
          teamId: oauth.team?.id || null,
          teamName: oauth.team?.name || null,
        },
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        provider: "slack",
        scopes: scopeValue ?? null,
        status: "connected",
        meta: {
          connectedAt: new Date().toISOString(),
          teamId: oauth.team?.id || null,
          teamName: oauth.team?.name || null,
        },
      },
    });

    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?success=slack_connected`,
    );
  } catch (err: any) {
    console.error("Slack OAuth callback failed:", err);
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/integrations?error=${encodeURIComponent(err?.message || "slack_connect_failed")}`,
    );
  }
}
