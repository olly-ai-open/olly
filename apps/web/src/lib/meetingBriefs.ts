import { prisma } from "@/lib/prisma";
import { generateMeetingBriefForEventCore } from "@olly/core";
import type { UserSettings } from "@/lib/settings";

export async function generateMeetingBriefForEvent(opts: {
  userId: string;
  eventId: string;
  token?: string;
  userSettings?: UserSettings;
  persist?: boolean;
  force?: boolean;
}) {
  return generateMeetingBriefForEventCore(prisma, opts);
}
