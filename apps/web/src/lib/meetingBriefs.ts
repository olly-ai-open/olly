import { prisma } from "@/lib/prisma";
import {
  generateMeetingBriefForEventCore,
  type MeetingBriefDebugContext,
  type MeetingBriefSearchStrategy,
} from "@olly/core";
import type { UserSettings } from "@/lib/settings";

export type { MeetingBriefSearchStrategy, MeetingBriefDebugContext };

export async function generateMeetingBriefForEvent(opts: {
  userId: string;
  eventId: string;
  searchStrategy: MeetingBriefSearchStrategy;
  token?: string;
  userSettings?: UserSettings;
  debug?: MeetingBriefDebugContext;
  persist?: boolean;
}) {
  return generateMeetingBriefForEventCore(prisma, opts);
}
