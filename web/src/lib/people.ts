import { prisma } from "@/lib/prisma";

export async function upsertPersonsForEmails(userId: string, emails: (string | null | undefined)[]) {
  const uniq = Array.from(new Set(emails.filter(Boolean) as string[])).slice(0, 50);
  if (!uniq.length) return [] as const;
  const existing = await prisma.person.findMany({ where: { userId, email: { in: uniq } } });
  const existingMap = new Map(existing.map((p) => [p.email || "", p]));
  const toCreate = uniq.filter((e) => !existingMap.has(e));
  if (toCreate.length) {
    await prisma.person.createMany({ data: toCreate.map((email) => ({ userId, email })) });
  }
  const final = await prisma.person.findMany({ where: { userId, email: { in: uniq } } });
  return final;
}

export async function linkMeetingParticipants(meetingId: string, personIds: string[]) {
  if (!personIds.length) return;
  const data = personIds.map((pid) => ({ meetingId, personId: pid }));
  await prisma.meetingParticipant.createMany({ data, skipDuplicates: true });
}

export async function linkBriefParticipants(briefId: string, personIds: string[]) {
  if (!personIds.length) return;
  const data = personIds.map((pid) => ({ briefId, personId: pid }));
  await prisma.briefParticipant.createMany({ data, skipDuplicates: true });
}
