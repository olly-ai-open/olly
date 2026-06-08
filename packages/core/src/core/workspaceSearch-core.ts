import type { PrismaClient } from "@prisma/client";
import {
  searchDriveSnippetsWithToken,
  searchGmailMessagesWithToken,
  type GoogleAccountLike,
} from "../google-http";
import { getUserSearchTimeframeCore } from "./settings-core";
import { getAccessTokenFromAccountCore } from "./google-core";
import {
  formatSlackDate,
  searchSlackMessagesWithToken,
  type SlackSearchResult,
} from "../slack-http";
import { getSlackAccessTokenFromAccountCore } from "./slack-core";

export class WorkspaceSearchCore {
  private readonly prisma: PrismaClient;
  private readonly userId: string;

  constructor(prisma: PrismaClient, userId: string) {
    this.prisma = prisma;
    this.userId = userId;
  }

  private async getGoogleToken(): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { userId: this.userId, provider: "google" },
      orderBy: { expires_at: "desc" },
    });
    if (!account) throw new Error("no_auth_account");
    return getAccessTokenFromAccountCore(
      this.prisma,
      account as GoogleAccountLike & { id?: string; userId?: string },
    );
  }

  private async getSlackToken(): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { userId: this.userId, provider: "slack" },
      orderBy: { expires_at: "desc" },
    });
    if (!account) throw new Error("no_slack_account");
    return getSlackAccessTokenFromAccountCore(this.prisma, account);
  }

  async searchDrive(query: string, maxResults = 5) {
    if (!query) {
      return { files: [], actualQuery: undefined as string | undefined };
    }
    const token = await this.getGoogleToken();
    const timeframeDays = await getUserSearchTimeframeCore(
      this.userId,
    );
    return searchDriveSnippetsWithToken(
      token,
      query,
      maxResults,
      undefined,
      timeframeDays,
    );
  }

  async searchGmail(query: string, maxResults = 5) {
    if (!query) return [];
    const token = await this.getGoogleToken();
    return searchGmailMessagesWithToken(token, query, maxResults);
  }

  async searchSlack(
    query: string,
    opts?: {
      maxResults?: number;
      windowStart?: Date;
      windowEnd?: Date;
    },
  ): Promise<SlackSearchResult[]> {
    if (!query) return [];
    const token = await this.getSlackToken();
    let finalQuery = query.trim();

    if (opts?.windowStart && opts?.windowEnd) {
      const start = formatSlackDate(opts.windowStart);
      const end = formatSlackDate(opts.windowEnd);
      finalQuery = `${finalQuery} after:${start} before:${end}`.trim();
    } else {
      const timeframeDays = await getUserSearchTimeframeCore(
        this.userId,
      );
      if (timeframeDays && timeframeDays > 0) {
        const start = new Date();
        start.setUTCDate(start.getUTCDate() - timeframeDays);
        finalQuery = `${finalQuery} after:${formatSlackDate(start)}`.trim();
      }
    }

    const { messages } = await searchSlackMessagesWithToken(
      token,
      finalQuery,
      opts?.maxResults ?? 5,
    );
    return messages;
  }
}