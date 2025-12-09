import type { PrismaClient } from "@prisma/client";

type SlackAccountLike = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
  token_type: string | null;
};

async function refreshSlackAccessToken(
  prisma: PrismaClient,
  account: SlackAccountLike & { id?: string },
): Promise<{ accessToken: string; expiresAt: number | null }> {
  if (!account.refresh_token) {
    throw new Error("REAUTH_REQUIRED");
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("missing_slack_credentials");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data: any = await resp.json();
  if (!data?.ok) {
    if (data?.error === "token_revoked" || data?.error === "invalid_grant") {
      if (account.id) {
        await prisma.account.update({
          where: { id: account.id },
          data: {
            access_token: null,
            refresh_token: null,
            expires_at: null,
          },
        });
      }
      throw new Error("REAUTH_REQUIRED");
    }
    throw new Error(data?.error || "slack_refresh_failed");
  }

  const expiresAt = data.expires_in
    ? Math.floor(Date.now() / 1000) + Number(data.expires_in)
    : null;

  if (account.id) {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: data.access_token as string,
        refresh_token:
          (data.refresh_token as string | null | undefined) ??
          account.refresh_token,
        expires_at: expiresAt,
        scope: (data.scope as string | null | undefined) ?? account.scope,
        token_type:
          (data.token_type as string | null | undefined) ?? account.token_type,
      },
    });
  }

  return { accessToken: data.access_token as string, expiresAt };
}

export async function getSlackAccessTokenFromAccountCore(
  prisma: PrismaClient,
  account: SlackAccountLike & { id?: string },
): Promise<string> {
  const expiresAtMs = account.expires_at ? account.expires_at * 1000 : null;
  const isExpired = expiresAtMs ? Date.now() >= expiresAtMs : false;

  if (account.access_token && !isExpired) {
    return account.access_token;
  }

  const refreshed = await refreshSlackAccessToken(prisma, account);
  return refreshed.accessToken;
}
