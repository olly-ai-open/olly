import { prisma } from "@/lib/prisma";
import {
  generateMeetingBriefForEventCore,
  type MeetingBriefSearchStrategy,
} from "@olly/core";
import type { UserSettings } from "@/lib/settings";

export type { MeetingBriefSearchStrategy };

export async function generateMeetingBriefForEvent(opts: {
  userId: string;
  eventId: string;
  searchStrategy: MeetingBriefSearchStrategy;
  token?: string;
  userSettings?: UserSettings;
  persist?: boolean;
  force?: boolean;
}) {
  return generateMeetingBriefForEventCore(prisma, opts);
}
