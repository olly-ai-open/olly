import { prisma } from "@/lib/prisma";

export async function upsertMeetingFromEvent(userId: string, event: {
  id: string;
  title: string;
  start?: string | null;
  end?: string | null;
  attendees?: { email?: string | null }[];
  description?: string | null;
}) {
  const startsAt = event.start ? new Date(event.start) : new Date();
  const endsAt = event.end ? new Date(event.end) : null;
  return prisma.meeting.upsert({
    where: { userId_externalId: { userId, externalId: event.id } },
    update: {
      title: event.title,
      startsAt,
      endsAt,
      attendees: event.attendees ? event.attendees : undefined,
    },
    create: {
      userId,
      externalId: event.id,
      title: event.title,
      startsAt,
      endsAt,
      attendees: event.attendees ? event.attendees : undefined,
    },
  });
}

