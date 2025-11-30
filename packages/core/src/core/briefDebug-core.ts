import { S3DebugStorage, type DebugDataStructure } from "../s3-debug";

type TimelineEntry = Record<string, any>;

export class BriefDebugContext {
  readonly debugData: DebugDataStructure;
  private readonly startTime: number;

  constructor(userId: string = "") {
    this.startTime = Date.now();
    this.debugData = {
      version: "1.0",
      summary: {
        briefId: "",
        userId,
        timestamp: new Date().toISOString(),
        totalDuration: 0,
        apiCalls: 0,
        success: false,
      },
      timeline: [],
      searchResults: {
        drive: {
          queries: [],
          totalFound: 0,
          included: 0,
          results: [],
          errors: [],
        },
        gmail: {
          queries: [],
          totalFound: 0,
          included: 0,
          results: [],
          errors: [],
        },
      },
      llmContext: {
        systemPrompt: "",
        userPrompt: "",
        model: "",
        temperature: 0,
        response: "",
      },
    };
  }

  addTimelineEntry(action: string, details?: TimelineEntry) {
    this.debugData.timeline.push({
      timestamp: Date.now() - this.startTime,
      action,
      ...(details || {}),
    });
  }

  markSuccess(briefId: string, userId: string) {
    this.debugData.summary.briefId = briefId;
    this.debugData.summary.userId = userId;
    this.debugData.summary.success = true;
    this.debugData.summary.totalDuration = Date.now() - this.startTime;
  }

  markError(err: unknown, opts?: { briefId?: string; userId?: string }) {
    if (opts?.briefId) this.debugData.summary.briefId = opts.briefId;
    if (opts?.userId) this.debugData.summary.userId = opts.userId;
    this.debugData.summary.success = false;
    this.debugData.summary.error =
      err instanceof Error ? err.message : "unknown error";
    this.debugData.summary.totalDuration = Date.now() - this.startTime;
  }

  getMetadata() {
    return {
      totalDuration: this.debugData.summary.totalDuration,
      apiCalls: this.debugData.summary.apiCalls,
      driveResults: this.debugData.searchResults.drive.totalFound,
      gmailResults: this.debugData.searchResults.gmail.totalFound,
      timelineEvents: this.debugData.timeline.length,
    };
  }

  async uploadIfEnabled(briefId: string, userId: string) {
    if (!S3DebugStorage.isEnabled()) return { success: false as const };

    const storage = new S3DebugStorage();
    return storage.uploadDebugData(briefId, userId, this.debugData);
  }
}

export function createBriefDebugContext(userId: string = "") {
  return new BriefDebugContext(userId);
}
