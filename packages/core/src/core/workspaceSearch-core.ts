import type { PrismaClient } from "@prisma/client";
import {
  searchDriveSnippetsWithToken,
  searchGmailMessagesWithToken,
  type GoogleAccountLike,
} from "../google-http";
import { getUserSearchTimeframeCore } from "./settings-core";
import { getAccessTokenFromAccountCore } from "./google-core";

export class WorkspaceSearchCore {
  private readonly prisma: PrismaClient;
  private readonly userId: string;

  constructor(prisma: PrismaClient, userId: string) {
    this.prisma = prisma;
    this.userId = userId;
  }

  private async getToken(): Promise<string> {
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

  async searchDrive(query: string, maxResults = 5) {
    if (!query) {
      return { files: [], actualQuery: undefined as string | undefined };
    }
    const token = await this.getToken();
    const timeframeDays = await getUserSearchTimeframeCore(
      this.prisma,
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
    const token = await this.getToken();
    return searchGmailMessagesWithToken(token, query, maxResults);
  }
}
