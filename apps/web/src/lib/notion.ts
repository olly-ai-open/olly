import { getCredential, hasCredential } from "@/lib/credentials";

export function buildNotionAuthorizeUrl(userId: string): string {
  const clientId = process.env.NOTION_CLIENT_ID;
  const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/notion-connect/callback`;
  if (!clientId) throw new Error("NOTION_CLIENT_ID not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state: userId,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export async function exchangeNotionOAuthCode(
  code: string,
  redirectUri: string,
): Promise<any> {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error("Notion OAuth credentials not configured");
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion OAuth token exchange failed: ${error}`);
  }
  return await response.json();
}

export async function checkNotionHealth(
  userId: string,
): Promise<{ connected: boolean }> {
  try {
    const connected = await hasCredential(userId, "notion");
    return { connected };
  } catch {
    return { connected: false };
  }
}

export async function getNotionToken(userId: string): Promise<string | null> {
  try {
    const data = await getCredential(userId, "notion");
    return data?.accessToken || null;
  } catch {
    return null;
  }
}