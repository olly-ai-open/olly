import { searchDriveSnippets, searchGmailMessages } from "@/lib/google";

export class WorkspaceSearch {
  private readonly userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async searchDrive(query: string, maxResults = 5) {
    if (!query) {
      return { files: [], actualQuery: undefined as string | undefined };
    }
    return searchDriveSnippets(this.userId, query, maxResults);
  }

  async searchGmail(query: string, maxResults = 5) {
    if (!query) return [];
    return searchGmailMessages(this.userId, query, maxResults);
  }
}
