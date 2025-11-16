import { prisma } from "@/lib/prisma";

export async function upsertPersonsForEmails(
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
      data: toCreate.map((email: string) => ({ userId, email })),
    });
  }
  const final = await prisma.person.findMany({
    where: { userId, email: { in: uniq } },
  });
  return final;
}

export async function linkMeetingParticipants(
  meetingId: string,
  personIds: string[],
) {
  if (!personIds.length) return;
  const data = personIds.map((pid) => ({ meetingId, personId: pid }));
  await prisma.meetingParticipant.createMany({ data, skipDuplicates: true });
}

export async function linkBriefParticipants(
  briefId: string,
  personIds: string[],
) {
  if (!personIds.length) return;
  const data = personIds.map((pid) => ({ briefId, personId: pid }));
  await prisma.briefParticipant.createMany({ data, skipDuplicates: true });
}

export function extractNamesFromTitle(title: string): string[] {
  const patterns = [
    // "Call Craig", "Meeting with John", "Coffee with Mike", etc.
    /(?:call|meeting with|1:1 with?|coffee with|lunch with|sync with|chat with|interview with)\s+(\w+)/gi,
    // "Craig call", "John sync", "Sarah meeting", etc.
    /(\w+)\s+(?:1:1|1-1|sync|call|meeting|chat|interview)/gi,
    // "John / Sarah" or "John - Sarah" format
    /^(\w+)\s*[-\/]\s*(\w+)$/i,
    // "1:1: John" or "Meeting: Sarah" format
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
      // Global regex: use exec loop

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
      // Non-global: single match
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

export async function inferAttendeesFromTitle(
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
