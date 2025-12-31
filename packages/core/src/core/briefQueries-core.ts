import type { PrismaClient } from "@prisma/client";
import { WorkspaceSearchCore } from "./workspaceSearch-core";
import {
  listDriveFilesUpdatedWithinWithToken,
  listGmailMessagesWithinWithToken,
  exportDriveFileAsTextWithToken,
  extractPlainTextFromGmailMessage,
} from "../google-http";
import { getAccessTokenFromAccountCore } from "./google-core";

function getHeaderValue(headers: any[], name: string): string | null {
  const h = headers.find(
    (hh: any) => typeof hh?.name === "string" && hh.name.toLowerCase() === name,
  );
  return typeof h?.value === "string" && h.value.trim().length
    ? h.value.trim()
    : null;
}

export type WorkspaceQueryPlan = {
  driveQueries: string[];
  gmailQueries: string[];
  slackQueries?: string[];
  maxResults?: number;
  windowStart?: Date;
  windowEnd?: Date;
};

export type WorkspaceQueryResults = {
  drive: any[];
  gmail: any[];
  slack: any[];
};

export async function runWorkspaceQueryPlan(
  prisma: PrismaClient,
  userId: string,
  plan: WorkspaceQueryPlan,
): Promise<WorkspaceQueryResults> {
  const workspaceSearch = new WorkspaceSearchCore(prisma, userId);
  const driveResults: any[] = [];
  const gmailResults: any[] = [];
  const slackResults: any[] = [];
  const maxResults = plan.maxResults ?? 5;
  const slackQueries = plan.slackQueries ?? [];
  let exportToken: string | null = null;
  const slackSeen = new Set<string>();

  // If time-window is specified, use recent-search endpoints for consistency
  if (plan.windowStart && plan.windowEnd) {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) throw new Error("no_account");
    const token = await getAccessTokenFromAccountCore(prisma, account);

    // Drive recent
    try {
      const driveRes = await listDriveFilesUpdatedWithinWithToken(
        token,
        plan.windowStart,
        plan.windowEnd,
        { pageSize: maxResults, pageToken: null },
      );
      for (const f of driveRes.files.slice(0, maxResults)) {
        try {
          const exported = await exportDriveFileAsTextWithToken(
            token,
            f.id,
            f.mimeType,
          );
          if (exported?.text?.trim()) {
            driveResults.push({
              ...f,
              text: exported.text.trim(),
            });
          }
        } catch (err: any) {
          console.error("Drive file export error:", err);
        }
      }
    } catch (err: any) {
      console.error("Drive recent search error:", err);
    }

    // Gmail recent
    try {
      const gmailRes = await listGmailMessagesWithinWithToken(
        token,
        plan.windowStart,
        plan.windowEnd,
        { maxResults, pageToken: null },
      );
      for (const m of gmailRes.messages.slice(0, maxResults)) {
        const text = extractPlainTextFromGmailMessage(m);
        if (!text.trim()) continue;
        gmailResults.push({
          ...m,
          text: text.trim(),
        });
      }
    } catch (err: any) {
      console.error("Gmail recent search error:", err);
    }
    for (const query of slackQueries) {
      const slackStart = Date.now();
      const q = query.trim();
      if (!q.length) continue;
      try {
        const results = await workspaceSearch.searchSlack(q, {
          maxResults,
          windowStart: plan.windowStart,
          windowEnd: plan.windowEnd,
        });
        for (const r of results) {
          const key = r.permalink || `${r.channel?.id || "slack"}:${r.ts || r.id}`;
          if (slackSeen.has(key)) continue;
          slackSeen.add(key);
          slackResults.push(r);
        }
      } catch (err: any) {
        console.error("Slack recent search error:", err);
      }
    }

    return { drive: driveResults, gmail: gmailResults, slack: slackResults };
  }

  const ensureToken = async () => {
    if (exportToken) return exportToken;
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) throw new Error("no_account");
    exportToken = await getAccessTokenFromAccountCore(prisma, account);
    return exportToken;
  };

  for (const query of plan.driveQueries) {
    const driveStart = Date.now();
    try {
      const { files } = await workspaceSearch.searchDrive(query, maxResults);
      for (const f of files) {
        try {
          const token = await ensureToken();
          const exported = await exportDriveFileAsTextWithToken(
            token,
            f.id,
            f.mimeType,
          );
          driveResults.push({
            ...f,
            text: exported?.text || "",
          });
        } catch (err: any) {
          console.error("Drive export error:", err);
        }
      }
    } catch (err: any) {
      console.error("Drive search error:", err);
    }
  }

  for (const query of plan.gmailQueries) {
    try {
      const gmail = await workspaceSearch.searchGmail(query, maxResults);
      gmailResults.push(
        ...gmail.map((m: any) => ({
          ...m,
          text: extractPlainTextFromGmailMessage(m),
        })),
      );
    } catch (err: any) {
      console.error("Gmail search error:", err);
    }
  }

  for (const query of slackQueries) {
    const q = query.trim();
    if (!q.length) continue;
    try {
      const results = await workspaceSearch.searchSlack(q, {
        maxResults,
      });
      for (const r of results) {
        const key = r.permalink || `${r.channel?.id || "slack"}:${r.ts || r.id}`;
        if (slackSeen.has(key)) continue;
        slackSeen.add(key);
        slackResults.push(r);
      }
    } catch (err: any) {
      console.error("Slack search error:", err);
    }
  }

  return { drive: driveResults, gmail: gmailResults, slack: slackResults };
}