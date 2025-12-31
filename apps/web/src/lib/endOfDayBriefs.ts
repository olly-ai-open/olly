import { prisma } from "@/lib/prisma";
import { generateEndOfDayBriefForUserCore } from "@olly/core";

export async function generateEndOfDayBriefForUser(opts: {
  userId: string;
  briefTime?: Date;
  windowHours?: number;
}) {
  const { userId, briefTime, windowHours } = opts;
  return generateEndOfDayBriefForUserCore(prisma, userId, {
    briefTime,
    windowHours,
  });
}
