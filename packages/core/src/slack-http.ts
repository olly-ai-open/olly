type SlackSearchMatch = {
  iid?: string | number;
  team?: string;
  channel?: { id?: string; name?: string };
  user?: string;
  username?: string;
  ts?: string;
  text?: string;
  permalink?: string;
  files?: any[];
  blocks?: any[];
  attachments?: any[];
  plain_text?: string;
};

export type SlackSearchResult = {
  id: string;
  teamId?: string | null;
  channel?: { id?: string | null; name?: string | null };
  userId?: string | null;
  username?: string | null;
  ts?: string | null;
  text?: string | null;
  permalink?: string | null;
  attachments?: any[];
};

export function formatSlackDate(iso: Date) {
  return iso.toISOString().slice(0, 10);
}

export async function searchSlackMessagesWithToken(
  token: string,
  query: string,
  maxResults = 5,
): Promise<{ messages: SlackSearchResult[] }> {
  const url = new URL("https://slack.com/api/search.messages");
  url.searchParams.set("query", query);
  url.searchParams.set("count", String(maxResults));
  url.searchParams.set("sort", "timestamp");
  url.searchParams.set("sort_dir", "desc");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data: any = await resp.json();
  if (!data?.ok) {
    throw new Error(data?.error || "slack_search_failed");
  }

  const matches: SlackSearchMatch[] = Array.isArray(data.messages?.matches)
    ? data.messages.matches
    : [];

  const messages: SlackSearchResult[] = matches.slice(0, maxResults).map((m) => ({
    id:
      typeof m.iid !== "undefined" && m.iid !== null
        ? String(m.iid)
        : m.ts && m.channel?.id
          ? `${m.channel.id}-${m.ts}`
          : m.ts || Math.random().toString(36).slice(2),
    teamId: m.team ?? null,
    channel: {
      id: m.channel?.id || null,
      name: m.channel?.name || null,
    },
    userId: m.user || null,
    username: m.username || null,
    ts: m.ts || null,
    text: m.plain_text || m.text || null,
    permalink: m.permalink || null,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
  }));

  return { messages };
}
