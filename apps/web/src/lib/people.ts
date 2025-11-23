import { prisma } from "@/lib/prisma";
import {
  deriveNameFromEmail,
  extractNamesFromTitle,
  inferAttendeesFromTitleCore,
  linkBriefParticipantsCore,
  linkMeetingParticipantsCore,
  upsertPersonsForEmailsCore,
} from "@olly/core";

export { deriveNameFromEmail, extractNamesFromTitle };

export async function upsertPersonsForEmails(
  userId: string,
  emails: (string | null | undefined)[],
) {
  return upsertPersonsForEmailsCore(prisma, userId, emails);
}

export async function linkMeetingParticipants(
  meetingId: string,
  personIds: string[],
) {
  return linkMeetingParticipantsCore(prisma, meetingId, personIds);
}

export async function linkBriefParticipants(
  briefId: string,
  personIds: string[],
) {
  return linkBriefParticipantsCore(prisma, briefId, personIds);
}

export async function inferAttendeesFromTitle(
  userId: string,
  title: string,
): Promise<{ inferredAttendees: string[]; namesFromTitle: string[] }> {
  return inferAttendeesFromTitleCore(prisma, userId, title);
}
