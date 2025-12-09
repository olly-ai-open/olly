import { prisma } from "@/lib/prisma";
import { getSlackAccessTokenFromAccountCore } from "@olly/core";

export type SlackAccountLike = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
  token_type: string | null;
};

type SlackOAuthResponse = {
  ok: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  team?: {
    id: string;
    name: string;
  };
  authed_user?: {
    id?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  };
  error?: string;
};

export type SlackHealth = {
  connected: boolean;
  teamName?: string | null;
  teamId?: string | null;
  userId?: string | null;
  scopes?: string | null;
  reason?: string;
};

const DEFAULT_SLACK_SCOPES = [
  "search:read",
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "users:read",
];

export function getSlackScopes() {
  const fromEnv = process.env.SLACK_SCOPES;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.split(",").map((s) => s.trim());
  }
  return DEFAULT_SLACK_SCOPES;
}

export function buildSlackAuthorizeUrl(state: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    throw new Error("missing_slack_credentials");
  }

  const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/slack-connect/callback`;
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  // Request user-level scopes so search/history APIs succeed.
  url.searchParams.set("user_scope", getSlackScopes().join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export async function exchangeSlackOAuthCode(
  code: string,
  redirectUri: string,
): Promise<SlackOAuthResponse> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("missing_slack_credentials");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const resp = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data: SlackOAuthResponse = await resp.json();
  return data;
}

export async function getSlackAccessTokenFromAccount(
  account: SlackAccountLike & { id?: string },
): Promise<string> {
  return getSlackAccessTokenFromAccountCore(prisma, account);
}

export async function getUserSlackAccount(userId: string) {
  return prisma.account.findFirst({
    where: { userId, provider: "slack" },
    orderBy: { expires_at: "desc" },
  });
}

export async function checkSlackHealth(userId: string): Promise<SlackHealth> {
  const account = await getUserSlackAccount(userId);
  if (!account) {
    return {
      connected: false,
      reason: "no_account",
    } as const;
  }

  try {
    const token = await getSlackAccessTokenFromAccount(account);
    const resp = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: any = await resp.json();
    if (!data?.ok) {
      throw new Error(data?.error || "auth_test_failed");
    }

    return {
      connected: true,
      teamName: (data.team as string) || null,
      teamId: (data.team_id as string) || null,
      userId: (data.user_id as string) || null,
      scopes: account.scope ?? null,
    };
  } catch (err: any) {
    return {
      connected: false,
      reason: err?.message || "unknown_error",
      scopes: account.scope ?? null,
    };
  }
}
