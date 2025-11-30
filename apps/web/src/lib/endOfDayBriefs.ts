import { prisma } from "@/lib/prisma";
import { generateEndOfDayBriefForUserCore } from "@olly/core";

export async function generateEndOfDayBriefForUser(opts: {
  userId: string;
  briefTime?: Date;
  windowHours?: number;
  debug?: {
    debugData: any;
    addTimelineEntry: (action: string, details?: any) => void;
  };
}) {
  const { userId, briefTime, windowHours, debug } = opts;
  return generateEndOfDayBriefForUserCore(prisma, userId, {
    briefTime,
    windowHours,
    debug,
  });
}
