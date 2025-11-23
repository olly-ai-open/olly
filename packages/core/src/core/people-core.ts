import type { PrismaClient } from "@prisma/client";

export async function upsertPersonsForEmailsCore(
  prisma: PrismaClient,
  userId: string,
  emails: (string | null | undefined)[],
) {
  const uniq = Array.from(new Set(emails.filter(Boolean) as string[])).slice(
    0,
    50,
  );
  if (!uniq.length) return [] as const;
  const existing = await prisma.person.findMany({
    where: { userId, email: { in: uniq } },
  });
  const existingMap = new Map(existing.map((p: any) => [p.email || "", p]));
  const toCreate = uniq.filter((e: string) => !existingMap.has(e));
  if (toCreate.length) {
    await prisma.person.createMany({
      data: toCreate.map((email: string) => ({
        userId,
        email,
        name: deriveNameFromEmail(email),
      })),
    });
  }
  const final = await prisma.person.findMany({
    where: { userId, email: { in: uniq } },
  });
  return final;
}

export function deriveNameFromEmail(email: string): string | null {
  const [local] = email.split("@");
  if (!local) return null;
  const parts = local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.length <= 64);
  if (!parts.length) return null;
  const name = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
  return name || null;
}

export async function linkMeetingParticipantsCore(
  prisma: PrismaClient,
  meetingId: string,
  personIds: string[],
) {
  if (!personIds.length) return;
  const data = personIds.map((pid) => ({ meetingId, personId: pid }));
  await prisma.meetingParticipant.createMany({ data, skipDuplicates: true });
}

export async function linkBriefParticipantsCore(
  prisma: PrismaClient,
  briefId: string,
  personIds: string[],
) {
  if (!personIds.length) return;
  const data = personIds.map((pid) => ({ briefId, personId: pid }));
  await prisma.briefParticipant.createMany({ data, skipDuplicates: true });
}

export async function inferAttendeesFromTitleCore(
  prisma: PrismaClient,
  userId: string,
  title: string,
): Promise<{ inferredAttendees: string[]; namesFromTitle: string[] }> {
  const namesFromTitle = extractNamesFromTitle(title);
  if (!namesFromTitle.length) {
    return { inferredAttendees: [], namesFromTitle };
  }

  const potentialPeople = await prisma.person.findMany({
    where: {
      userId,
      OR: namesFromTitle.map((name) => ({
        OR: [
          { name: { contains: name, mode: "insensitive" as const } },
          {
            email: {
              contains: name.toLowerCase(),
              mode: "insensitive" as const,
            },
          },
        ],
      })),
    },
    select: { email: true, name: true },
  });

  const inferredAttendees = potentialPeople
    .map((p) => p.email)
    .filter(Boolean) as string[];

  return { inferredAttendees, namesFromTitle };
}

export function extractNamesFromTitle(title: string): string[] {
  const patterns = [
    /(?:call|meeting with|1:1 with?|coffee with|lunch with|sync with|chat with|interview with)\s+(\w+)/gi,
    /(\w+)\s+(?:1:1|1-1|sync|call|meeting|chat|interview)/gi,
    /^(\w+)\s*[-\/]\s*(\w+)$/i,
    /(?:1:1:|meeting:|call:|sync:)\s*(\w+)/gi,
  ];

  const potentialNames = new Set<string>();
  const commonWords = new Set([
    "the",
    "with",
    "and",
    "team",
    "weekly",
    "daily",
    "monthly",
    "standup",
    "all",
    "staff",
    "internal",
    "external",
  ]);

  for (const pattern of patterns) {
    let match;
    if (pattern.global) {
      while ((match = pattern.exec(title)) !== null) {
        for (let i = 1; i < match.length; i++) {
          if (match[i]) {
            const name = match[i].trim();
            if (name.length > 2 && !commonWords.has(name.toLowerCase())) {
              potentialNames.add(name);
            }
          }
        }
      }
    } else {
      match = title.match(pattern);
      if (match) {
        for (let i = 1; i < match.length; i++) {
          if (match[i]) {
            const name = match[i].trim();
            if (name.length > 2 && !commonWords.has(name.toLowerCase())) {
              potentialNames.add(name);
            }
          }
        }
      }
    }
  }

  return Array.from(potentialNames);
}
