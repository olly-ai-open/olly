import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

export function getOAuthClient(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const defaultRedirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/callback/google`;
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri || defaultRedirectUri,
  );
}

export type GoogleAccountLike = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
  token_type: string | null;
  id_token: string | null;
};

export async function getAccessTokenFromAccount(
  account: GoogleAccountLike & { id?: string; userId?: string },
): Promise<string> {
  const oAuth2Client = getOAuthClient();
  const expiresAt = account.expires_at ? account.expires_at * 1000 : undefined;

  // Check if token is expired
  const now = Date.now();
  const isExpired = expiresAt ? now >= expiresAt : false;

  oAuth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token || undefined,
    expiry_date: expiresAt,
    scope: (account.scope ?? undefined) as string | undefined,
    token_type: (account.token_type ?? undefined) as any,
    id_token: account.id_token || undefined,
  });

  try {
    // If token is expired or we don't have an access token, try to refresh
    if (isExpired || !account.access_token) {
      if (!account.refresh_token) {
        throw new Error("REAUTH_REQUIRED");
      }

      console.log("Token expired or missing, refreshing...");

      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();

        // Update the database with new tokens if we have account id
        if (account.id && credentials.access_token) {
          const newExpiresAt = credentials.expiry_date
            ? Math.floor(credentials.expiry_date / 1000)
            : null;

          await prisma.account.update({
            where: { id: account.id },
            data: {
              access_token: credentials.access_token,
              expires_at: newExpiresAt,
              token_type: credentials.token_type || account.token_type,
              scope: credentials.scope || account.scope,
              id_token: credentials.id_token || account.id_token,
            },
          });
          console.log("Updated account with new access token");
        }

        return credentials.access_token!;
      } catch (refreshError: any) {
        // Check if this is an invalid_grant error (expired refresh token)
        if (
          refreshError?.response?.data?.error === "invalid_grant" ||
          refreshError?.message?.includes("invalid_grant") ||
          refreshError?.code === 400
        ) {
          console.error(
            "Refresh token is invalid or expired - re-authentication required",
          );
          // Mark the account as needing re-authentication
          if (account.id) {
            // Clear the invalid tokens
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
        throw refreshError;
      }
    }

    // Token is still valid, use it
    return account.access_token!;
  } catch (error: any) {
    if (error.message === "REAUTH_REQUIRED") {
      throw error;
    }
    console.error("Failed to get access token:", error);
    throw error;
  }
}

export async function getUserGoogleAuth(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
  });
  if (!accounts.length) return null;
  const withAccess = accounts.filter((a: any) => !!a.access_token);
  const byExpiry = (a?: number | null) => (a ? a : 0);
  const account =
    withAccess
      .sort((a: any, b: any) => byExpiry(a.expires_at) - byExpiry(b.expires_at))
      .pop() ||
    accounts.find((a: any) => !!a.refresh_token) ||
    accounts[0];

  const oAuth2Client = getOAuthClient();
  const expiresAt = account.expires_at ? account.expires_at * 1000 : undefined;
  oAuth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token || undefined,
    expiry_date: expiresAt,
    scope: (account.scope ?? undefined) as string | undefined,
    token_type: account.token_type as any,
    id_token: account.id_token || undefined,
  });
  return oAuth2Client;
}

async function getValidAccessToken(userId: string): Promise<string> {
  // Get the account directly to use our updated getAccessTokenFromAccount function
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    orderBy: { expires_at: "desc" },
  });

  if (!account) throw new Error("no_auth_account");

  return await getAccessTokenFromAccount(account);
}

export async function checkGoogleHealth(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
  });
  if (!accounts.length)
    return {
      connected: false,
      reason: "no_account",
      hasAdvancedScopes: false,
    } as const;

  // Check if user has advanced scopes
  const hasAdvancedScopes = accounts.some((a) => {
    const scopes = a.scope || "";
    return (
      scopes.includes("calendar.readonly") ||
      scopes.includes("drive.readonly") ||
      scopes.includes("drive.file") ||
      scopes.includes("gmail.readonly")
    );
  });

  // If they don't have advanced scopes, return basic connection status
  if (!hasAdvancedScopes) {
    return {
      connected: true,
      hasAdvancedScopes: false,
      reason: "basic_auth_only",
    } as const;
  }

  try {
    const token = await getValidAccessToken(userId);
    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`calendar_health_failed: ${resp.status} ${body}`);
    }
    return { connected: true, hasAdvancedScopes: true } as const;
  } catch (err: any) {
    const a = accounts[0];
    const hasAccess = !!a?.access_token;
    const hasRefresh = !!a?.refresh_token;
    const exp = a?.expires_at
      ? new Date(a.expires_at * 1000).toISOString()
      : null;
    return {
      connected: false,
      hasAdvancedScopes,
      reason: err?.message || "unknown_error",
      tokenInfo: { hasAccess, hasRefresh, expiresAt: exp },
    } as const;
  }
}

export async function checkGoogleHealthWithToken(account: GoogleAccountLike) {
  try {
    const token = await getAccessTokenFromAccount(account);
    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`calendar_health_failed: ${resp.status} ${body}`);
    }
    return { connected: true } as const;
  } catch (err: any) {
    const hasAccess = !!account?.access_token;
    const hasRefresh = !!account?.refresh_token;
    const exp = account?.expires_at
      ? new Date(account.expires_at * 1000).toISOString()
      : null;
    return {
      connected: false,
      reason: err?.message || "unknown_error",
      tokenInfo: { hasAccess, hasRefresh, expiresAt: exp },
    } as const;
  }
}

export async function listUpcomingMeetingsWithToken(
  token: string,
  opts?: { windowMinutes?: number },
) {
  const now = new Date();
  const windowMinutes = opts?.windowMinutes ?? 90;
  const max = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", max.toISOString());
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`events_list_failed: ${resp.status}`);
  const data: any = await resp.json();
  const events = (data.items as any[]) || [];
  return events.map((e) => ({
    id: e.id as string,
    title: (e.summary as string) || "(no title)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    attendees: Array.isArray(e.attendees)
      ? e.attendees.map((a: any) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        }))
      : [],
    hangoutLink:
      (e as any).hangoutLink ||
      (e.conferenceData?.entryPoints?.[0]?.uri ?? null),
    description: e.description || null,
  }));
}

export async function listEventsByDayWithToken(token: string, dayISO: string) {
  const start = new Date(`${dayISO}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", start.toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`events_list_failed: ${resp.status}`);
  const data: any = await resp.json();
  const events = (data.items as any[]) || [];
  return events.map((e) => ({
    id: e.id as string,
    title: (e.summary as string) || "(no title)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    attendees: Array.isArray(e.attendees)
      ? e.attendees.map((a: any) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        }))
      : [],
    hangoutLink:
      (e as any).hangoutLink ||
      (e.conferenceData?.entryPoints?.[0]?.uri ?? null),
    description: e.description || null,
  }));
}

export async function getEventDetailsWithToken(token: string, eventId: string) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`event_get_failed: ${resp.status}`);
  const e: any = await resp.json();
  return {
    id: e.id as string,
    title: (e.summary as string) || "(no title)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    attendees: Array.isArray(e.attendees)
      ? e.attendees.map((a: any) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        }))
      : [],
    hangoutLink:
      (e as any).hangoutLink ||
      (e.conferenceData?.entryPoints?.[0]?.uri ?? null),
    description: e.description || null,
    raw: e,
  };
}

export async function searchDriveSnippetsWithToken(
  token: string,
  query: string,
  maxResults = 5,
  folderIds?: string[],
) {
  const escapedQuery = query.replace(/'/g, "\\'");

  // Search both file names AND full text content
  let q = `(name contains '${escapedQuery}' or fullText contains '${escapedQuery}') and trashed = false`;

  // If specific folders are provided, limit search to those folders
  if (folderIds && folderIds.length > 0) {
    const folderQueries = folderIds
      .map((id) => `'${id}' in parents`)
      .join(" or ");
    q += ` and (${folderQueries})`;
  }

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,webViewLink,owners/displayName,modifiedTime,parents)",
  );
  url.searchParams.set("pageSize", String(maxResults));
  url.searchParams.set("orderBy", "modifiedTime desc");
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`drive_search_failed: ${resp.status}`);
  const data: any = await resp.json();
  return data.files || [];
}

export async function searchGmailSnippetsWithToken(
  token: string,
  query: string,
  maxResults = 5,
) {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const url = new URL(base);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  const listResp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listResp.ok) throw new Error(`gmail_list_failed: ${listResp.status}`);
  const list: any = await listResp.json();
  const ids: string[] = (list.messages || []).map((m: any) => m.id);
  const messages: any[] = [];
  for (const id of ids) {
    const mr = await fetch(`${base}/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mr.ok) continue;
    const md = await mr.json();
    messages.push({
      id: md.id,
      snippet: md.snippet,
      internalDate: md.internalDate,
    });
  }
  return messages;
}

export async function listUpcomingMeetings(
  userId: string,
  opts?: { windowMinutes?: number },
) {
  const token = await getValidAccessToken(userId);
  const now = new Date();
  const windowMinutes = opts?.windowMinutes ?? 90;
  const max = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", max.toISOString());
  url.searchParams.set("maxResults", "10");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`events_list_failed: ${resp.status}`);
  const data: any = await resp.json();
  const events = (data.items as any[]) || [];
  return events.map((e) => ({
    id: e.id as string,
    title: (e.summary as string) || "(no title)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    attendees: Array.isArray(e.attendees)
      ? e.attendees.map((a: any) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        }))
      : [],
    hangoutLink:
      (e as any).hangoutLink ||
      (e.conferenceData?.entryPoints?.[0]?.uri ?? null),
    description: e.description || null,
  }));
}

export async function getEventDetails(userId: string, eventId: string) {
  const token = await getValidAccessToken(userId);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`event_get_failed: ${resp.status}`);
  const e: any = await resp.json();
  return {
    id: e.id as string,
    title: (e.summary as string) || "(no title)",
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    attendees: Array.isArray(e.attendees)
      ? e.attendees.map((a: any) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        }))
      : [],
    hangoutLink:
      (e as any).hangoutLink ||
      (e.conferenceData?.entryPoints?.[0]?.uri ?? null),
    description: e.description || null,
    raw: e,
  };
}

export async function searchDriveSnippets(
  userId: string,
  query: string,
  maxResults = 5,
) {
  const token = await getValidAccessToken(userId);

  // Check user's Drive access preference
  const integration = await prisma.integration.findFirst({
    where: { userId, provider: "google_workspace" },
    select: { meta: true },
  });

  const driveAccess = (integration?.meta as any)?.driveAccess || "folders";

  if (driveAccess === "full") {
    // Search entire Google Drive
    return searchDriveSnippetsWithToken(token, query, maxResults);
  } else {
    // Search only selected folders (existing behavior)
    const allowedFolders = await prisma.driveFolder.findMany({
      where: { userId },
      select: { folderId: true },
    });

    const folderIds = allowedFolders.map((f) => f.folderId);

    // If no folders are selected, return empty results
    if (folderIds.length === 0) {
      return [];
    }

    return searchDriveSnippetsWithToken(token, query, maxResults, folderIds);
  }
}

export async function searchGmailSnippets(
  userId: string,
  query: string,
  maxResults = 5,
) {
  const token = await getValidAccessToken(userId);
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
  const url = new URL(base);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  const listResp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listResp.ok) throw new Error(`gmail_list_failed: ${listResp.status}`);
  const list: any = await listResp.json();
  const ids: string[] = (list.messages || []).map((m: any) => m.id);
  const messages: any[] = [];
  for (const id of ids) {
    const mr = await fetch(`${base}/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mr.ok) continue;
    const md = await mr.json();
    messages.push({
      id: md.id,
      snippet: md.snippet,
      internalDate: md.internalDate,
    });
  }
  return messages;
}
