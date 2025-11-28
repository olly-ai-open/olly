import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const revalidate = 0;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ people: [], meetings: [], briefs: [] });
  }

  const [people, meetings, briefs] = await Promise.all([
    prisma.person.findMany({
      where: {
        userId,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { org: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true, title: true, org: true },
      orderBy: { name: "asc" },
      take: 5,
    }),
    prisma.meeting.findMany({
      where: {
        userId,
        status: { not: "ignored" },
        title: { contains: q, mode: "insensitive" },
      },
      include: {
        briefs: { orderBy: { generatedAt: "desc" }, take: 1 },
      },
      orderBy: { startsAt: "desc" },
      take: 5,
    }),
    prisma.brief.findMany({
      where: {
        meeting: {
          userId,
          title: { contains: q, mode: "insensitive" },
        },
      },
      include: { meeting: true },
      orderBy: { generatedAt: "desc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    people,
    meetings,
    briefs: briefs.map((b) => ({
      id: b.id,
      generatedAt: b.generatedAt,
      meeting: {
        id: b.meetingId,
        title: b.meeting?.title,
        startsAt: b.meeting?.startsAt,
      },
    })),
  });
}
