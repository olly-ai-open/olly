import type { PrismaClient } from "@prisma/client";
import { WorkspaceSearchCore } from "./workspaceSearch-core";
import {
  listDriveFilesUpdatedWithinWithToken,
  listGmailMessagesWithinWithToken,
  exportDriveFileAsTextWithToken,
  extractPlainTextFromGmailMessage,
} from "../google-http";
import { getAccessTokenFromAccountCore } from "./google-core";
import type { DebugDataStructure } from "../s3-debug";

function getHeaderValue(headers: any[], name: string): string | null {
  const h = headers.find(
    (hh: any) => typeof hh?.name === "string" && hh.name.toLowerCase() === name,
  );
  return typeof h?.value === "string" && h.value.trim().length
    ? h.value.trim()
    : null;
}

type DebugCtx = {
  debugData?: DebugDataStructure | null;
  addTimelineEntry?: (action: string, details?: any) => void;
};

export type WorkspaceQueryPlan = {
  driveQueries: string[];
  gmailQueries: string[];
  maxResults?: number;
  windowStart?: Date;
  windowEnd?: Date;
};

export type WorkspaceQueryResults = {
  drive: any[];
  gmail: any[];
};

export async function runWorkspaceQueryPlan(
  prisma: PrismaClient,
  userId: string,
  plan: WorkspaceQueryPlan,
  debug?: DebugCtx,
): Promise<WorkspaceQueryResults> {
  const workspaceSearch = new WorkspaceSearchCore(prisma, userId);
  const addTimeline = debug?.addTimelineEntry ?? (() => {});
  const debugData = debug?.debugData ?? null;
  const driveResults: any[] = [];
  const gmailResults: any[] = [];
  const maxResults = plan.maxResults ?? 5;
  let exportToken: string | null = null;

  // If time-window is specified, use recent-search endpoints for consistency
  if (plan.windowStart && plan.windowEnd) {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
    });
    if (!account) throw new Error("no_account");
    const token = await getAccessTokenFromAccountCore(prisma, account);

    // Drive recent
    const driveQuery = `(modifiedTime > '${plan.windowStart.toISOString()}') and (modifiedTime <= '${plan.windowEnd.toISOString()}') and trashed = false`;
    addTimeline("DRIVE_SEARCH_START", { query: driveQuery });
    try {
      const driveRes = await listDriveFilesUpdatedWithinWithToken(
        token,
        plan.windowStart,
        plan.windowEnd,
        { pageSize: maxResults, pageToken: null },
      );
      if (debugData?.summary) debugData.summary.apiCalls += 1;
      if (debugData?.searchResults?.drive) {
        debugData.searchResults.drive.queries.push(driveQuery);
        debugData.searchResults.drive.totalFound += driveRes.files.length;
      }
      for (const f of driveRes.files.slice(0, maxResults)) {
        try {
          const exported = await exportDriveFileAsTextWithToken(
            token,
            f.id,
            f.mimeType,
          );
          if (debugData?.summary) debugData.summary.apiCalls += 1;
          if (exported?.text?.trim()) {
            driveResults.push({
              ...f,
              text: exported.text.trim(),
            });
          }
        } catch (err: any) {
          addTimeline("DRIVE_EXPORT_ERROR", {
            id: f.id,
            error: err?.message || "error",
          });
          if (debugData?.searchResults?.drive) {
            debugData.searchResults.drive.errors =
              debugData.searchResults.drive.errors || [];
            debugData.searchResults.drive.errors.push(
              err?.message || "drive_export_error",
            );
          }
        }
      }
      if (debugData?.searchResults?.drive) {
        debugData.searchResults.drive.results.push(
          ...driveRes.files.slice(0, 5).map((f: any) => ({
            id: f.id,
            title: f.name,
            link: f.webViewLink,
            updatedAt: f.modifiedTime,
          })),
        );
      }
    } catch (err: any) {
      addTimeline("DRIVE_SEARCH_ERROR", { error: err?.message || "error" });
      if (debugData) {
        debugData.searchResults.drive.errors =
          debugData.searchResults.drive.errors || [];
        debugData.searchResults.drive.errors.push(err?.message || "drive_error");
      }
    }
    addTimeline("DRIVE_SEARCH_COMPLETE", { count: driveResults.length });

    // Gmail recent
    const gmailQuery = `after:${Math.floor(plan.windowStart.getTime() / 1000)} before:${Math.floor(
      plan.windowEnd.getTime() / 1000,
    )}`;
    addTimeline("GMAIL_SEARCH_START", { query: gmailQuery });
    try {
      const gmailRes = await listGmailMessagesWithinWithToken(
        token,
        plan.windowStart,
        plan.windowEnd,
        { maxResults, pageToken: null },
      );
      if (debugData?.summary) debugData.summary.apiCalls += 1;
      if (debugData?.searchResults?.gmail) {
        debugData.searchResults.gmail.queries.push(gmailQuery);
        debugData.searchResults.gmail.totalFound += gmailRes.messages.length;
      }
      for (const m of gmailRes.messages.slice(0, maxResults)) {
        const text = extractPlainTextFromGmailMessage(m);
        if (!text.trim()) continue;
        gmailResults.push({
          ...m,
          text: text.trim(),
        });
      }
      if (debugData?.searchResults?.gmail) {
        debugData.searchResults.gmail.results.push(
          ...gmailRes.messages.slice(0, 5).map((m: any) => {
            const headers = Array.isArray(m.payload?.headers)
              ? m.payload.headers
              : [];
            return {
              id: m.id,
              title:
                getHeaderValue(headers, "subject") ||
                m.snippet ||
                "(no subject)",
              updatedAt: m.internalDate
                ? new Date(Number(m.internalDate)).toISOString()
                : plan.windowEnd?.toISOString(),
              link: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
              from: getHeaderValue(headers, "from") || "",
              to: getHeaderValue(headers, "to") || "",
              snippet: m.snippet || "",
            };
          }),
        );
      }
    } catch (err: any) {
      addTimeline("GMAIL_SEARCH_ERROR", { error: err?.message || "error" });
      if (debugData) {
        debugData.searchResults.gmail.errors =
          debugData.searchResults.gmail.errors || [];
        debugData.searchResults.gmail.errors.push(err?.message || "gmail_error");
      }
    }
    addTimeline("GMAIL_SEARCH_COMPLETE", { count: gmailResults.length });
    return { drive: driveResults, gmail: gmailResults };
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
          if (debugData?.summary) debugData.summary.apiCalls += 1;
          driveResults.push({
            ...f,
            text: exported?.text || "",
          });
        } catch (err: any) {
          addTimeline("DRIVE_EXPORT_ERROR", {
            id: f.id,
            error: err?.message || "error",
          });
          driveResults.push({ ...f, text: "" });
          if (debugData?.searchResults?.drive) {
            debugData.searchResults.drive.errors =
              debugData.searchResults.drive.errors || [];
            debugData.searchResults.drive.errors.push(
              err?.message || "drive_export_error",
            );
          }
        }
      }
      addTimeline("DRIVE_SEARCH", {
        query,
        resultCount: driveResults.length,
        duration: Date.now() - driveStart,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
        debugData.searchResults.drive.queries.push(query);
        debugData.searchResults.drive.totalFound += files.length;
        debugData.searchResults.drive.results.push(
          ...files.slice(0, 5).map((f: any) => ({
            id: f.id,
            title: f.name,
            link: f.webViewLink,
            updatedAt: f.modifiedTime,
            snippet: "",
          })),
        );
      }
    } catch (err: any) {
      addTimeline("DRIVE_SEARCH_ERROR", {
        query,
        error: err?.message,
        duration: Date.now() - driveStart,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
        debugData.searchResults.drive.errors =
          debugData.searchResults.drive.errors || [];
        debugData.searchResults.drive.errors.push(err?.message || "error");
      }
    }
  }

  for (const query of plan.gmailQueries) {
    const gmailStart = Date.now();
    try {
      const gmail = await workspaceSearch.searchGmail(query, maxResults);
      gmailResults.push(
        ...gmail.map((m: any) => ({
          ...m,
          text: extractPlainTextFromGmailMessage(m),
        })),
      );
      addTimeline("GMAIL_SEARCH", {
        query,
        resultCount: gmail.length,
        duration: Date.now() - gmailStart,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
        debugData.searchResults.gmail.queries.push(query);
        debugData.searchResults.gmail.totalFound += gmail.length;
        debugData.searchResults.gmail.results.push(
          ...gmail.slice(0, 5).map((m: any) => {
            const headers = Array.isArray(m.payload?.headers)
              ? m.payload.headers
              : [];
            return {
              id: m.id,
              title: getHeaderValue(headers, "subject") || m.snippet || "",
              from: getHeaderValue(headers, "from") || "",
              to: getHeaderValue(headers, "to") || "",
              snippet: m.snippet || "",
              updatedAt: m.internalDate
                ? new Date(Number(m.internalDate)).toISOString()
                : undefined,
              link: `https://mail.google.com/mail/u/0/#inbox/${m.id}`,
            };
          }),
        );
      }
    } catch (err: any) {
      addTimeline("GMAIL_SEARCH_ERROR", {
        query,
        error: err?.message,
        duration: Date.now() - gmailStart,
      });
      if (debugData) {
        debugData.summary.apiCalls += 1;
        debugData.searchResults.gmail.errors =
          debugData.searchResults.gmail.errors || [];
        debugData.searchResults.gmail.errors.push(err?.message || "error");
      }
    }
  }

  return { drive: driveResults, gmail: gmailResults };
}
