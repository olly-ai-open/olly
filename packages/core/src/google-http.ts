import { google } from "googleapis";

export type GoogleAccountLike = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  scope: string | null;
  token_type: string | null;
  id_token: string | null;
};

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

function getUtcRangeForLocalDay(dayISO: string, timeZone?: string | null) {
  if (!timeZone) {
    const start = new Date(`${dayISO}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const partsToObj = (d: Date) => {
      const parts = formatter.formatToParts(d);
      const obj: Record<string, string> = {};
      for (const p of parts) {
        if (p.type !== "literal") obj[p.type] = p.value;
      }
      return obj;
    };

    const [yearStr, monthStr, dayStr] = dayISO.split("-");
    const targetLocalMs = Date.UTC(
      Number(yearStr),
      Number(monthStr) - 1,
      Number(dayStr),
      0,
      0,
      0,
    );

    const guessUtc = new Date(`${dayISO}T00:00:00Z`);
    const currentParts = partsToObj(guessUtc);
    const currentLocalMs = Date.UTC(
      Number(currentParts.year),
      Number(currentParts.month) - 1,
      Number(currentParts.day),
      Number(currentParts.hour),
      Number(currentParts.minute),
      Number(currentParts.second),
    );

    const diffMs = targetLocalMs - currentLocalMs;
    const start = new Date(guessUtc.getTime() + diffMs);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  } catch {
    const fallbackStart = new Date(`${dayISO}T00:00:00`);
    const fallbackEnd = new Date(fallbackStart.getTime() + 24 * 60 * 60 * 1000);
    return { start: fallbackStart, end: fallbackEnd };
  }
}

export async function listEventsByDayWithToken(
  token: string,
  dayISO: string,
  timeZone?: string | null,
) {
  const { start, end } = getUtcRangeForLocalDay(dayISO, timeZone);
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

export async function listEventsInRangeWithToken(
  token: string,
  timeMin: Date,
  timeMax: Date,
) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("maxResults", "100");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    throw new Error(`events_range_list_failed: ${resp.status}`);
  }

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

export async function getDriveFilesByIdsWithToken(
  token: string,
  fileIds: string[],
) {
  const uniqueIds = Array.from(new Set(fileIds)).slice(0, 5);
  const results: any[] = [];

  for (const fileId of uniqueIds) {
    try {
      const url = new URL(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      );
      url.searchParams.set(
        "fields",
        "id,name,mimeType,webViewLink,modifiedTime",
      );
      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) continue;
      const meta: any = await resp.json();
      // We don't include content here; core modules can call
      // into the richer search APIs if needed.
      results.push({
        id: meta.id as string,
        name: (meta.name as string) || "(untitled)",
        mimeType: (meta.mimeType as string) || null,
        webViewLink: (meta.webViewLink as string) || null,
        modifiedTime: meta.modifiedTime || null,
      });
    } catch (error) {
      console.error(`Failed to fetch Drive file ${fileId}:`, error);
    }
  }

  return results;
}

export async function searchDriveSnippetsWithToken(
  token: string,
  query: string,
  maxResults = 5,
  folderIds?: string[],
  timeframeDays = 30,
): Promise<{ files: any[]; actualQuery: string }> {
  const escapedQuery = query.replace(/'/g, "\\'");

  const timeframeAgo = new Date();
  timeframeAgo.setDate(timeframeAgo.getDate() - timeframeDays);
  const dateFilter = timeframeAgo.toISOString().split(".")[0] + "Z";

  let q = `(name contains '${escapedQuery}' or fullText contains '${escapedQuery}') and trashed = false and modifiedTime > '${dateFilter}'`;

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
  const files = data.files || [];

  return { files, actualQuery: q };
}

export async function searchGmailMessagesWithToken(
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
    messages.push(md);
  }

  return messages;
}
