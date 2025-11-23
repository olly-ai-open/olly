import { prisma } from "@/lib/prisma";
import { upsertMeetingFromEventCore } from "@olly/core";

export async function upsertMeetingFromEvent(
  userId: string,
  event: {
    id: string;
    title: string;
    start?: string | null;
    end?: string | null;
    attendees?: { email?: string | null }[];
    description?: string | null;
  },
) {
  return upsertMeetingFromEventCore(prisma, userId, event);
}
