import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

export function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri = `${process.env.NEXTAUTH_URL?.replace(/\/$/, "")}/api/auth/callback/google`;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
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
  account: GoogleAccountLike,
): Promise<string> {
  const oAuth2Client = getOAuthClient();
  const expiresAt = account.expires_at ? account.expires_at * 1000 : undefined;
  oAuth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token || undefined,
    expiry_date: expiresAt,
    scope: (account.scope ?? undefined) as string | undefined,
    token_type: (account.token_type ?? undefined) as any,
    id_token: account.id_token || undefined,
  });
  let token =
    (await oAuth2Client.getAccessToken())?.token ||
    oAuth2Client.credentials.access_token ||
    undefined;
  if (!token && oAuth2Client.credentials.refresh_token) {
    const rt = await oAuth2Client.refreshAccessToken();
    token = rt.credentials.access_token || undefined;
  }
  if (!token) throw new Error("no_access_token");
  return token;
}

export async function getUserGoogleAuth(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
  });
  if (!accounts.length) return null;
  const withAccess = accounts.filter((a) => !!a.access_token);
  const byExpiry = (a?: number | null) => (a ? a : 0);
  const account =
    withAccess
      .sort((a, b) => byExpiry(a.expires_at) - byExpiry(b.expires_at))
      .pop() ||
    accounts.find((a) => !!a.refresh_token) ||
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
  const auth = await getUserGoogleAuth(userId);
  if (!auth) throw new Error("no_auth_client");
  let token =
    (await auth.getAccessToken())?.token ||
    auth.credentials.access_token ||
    undefined;
  if (!token && auth.credentials.refresh_token) {
    const rt = await auth.refreshAccessToken();
    token = rt.credentials.access_token || undefined;
    auth.setCredentials(rt.credentials);
  }
  if (!token) throw new Error("no_access_token");
  return token;
}

export async function checkGoogleHealth(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
  });
  if (!accounts.length)
    return { connected: false, reason: "no_account" } as const;
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
    return { connected: true } as const;
  } catch (err: any) {
    const a = accounts[0];
    const hasAccess = !!a?.access_token;
    const hasRefresh = !!a?.refresh_token;
    const exp = a?.expires_at
      ? new Date(a.expires_at * 1000).toISOString()
      : null;
    return {
      connected: false,
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
) {
  const q = `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,webViewLink,owners/displayName,modifiedTime)",
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
  const q = `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,webViewLink,owners/displayName,modifiedTime)",
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
