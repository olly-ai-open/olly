import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/sidebar";
import Link from "next/link";
import PeopleSearch from "@/components/people-search";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-sm text-muted-foreground">
          Sign in to view people.
        </div>
      </main>
    );
  }
  const userId = session.user.id;
  const sp = await searchParams;
  const q = (Array.isArray(sp?.q) ? sp?.q[0] : sp?.q)?.trim();

  const people = await prisma.person.findMany({
    where: {
      userId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { org: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 100,
  });

  // Count of open action items per person (assigned)
  const openCountsByPerson: Record<string, number> = {};
  const openCounts = await prisma.actionItemAssignee
    .groupBy({
      by: ["personId"],
      _count: { personId: true },
      where: {
        actionItem: {
          userId,
          OR: [{ status: { in: ["open", "todo"] } }, { status: null }],
        },
      },
    })
    .catch(() => [] as any);
  for (const r of openCounts as any[])
    openCountsByPerson[r.personId] = r._count?.personId || 0;

  // Enrich cards with next meeting, cadence, and last topic
  const now = new Date();
  const enrich = await Promise.all(
    people.map(async (p: any) => {
      // Next meeting
      const nextMp = await prisma.meetingParticipant
        .findFirst({
          where: { personId: p.id, meeting: { userId, startsAt: { gt: now } } },
          include: { meeting: true },
          orderBy: { meeting: { startsAt: "asc" } },
        })
        .catch(() => null as any);
      const nextStartsAt = nextMp?.meeting?.startsAt || null;

      // Cadence from last 60 days of meetings
      const since = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      const recentCount = await prisma.meetingParticipant
        .count({
          where: {
            personId: p.id,
            meeting: { userId, startsAt: { gte: since } },
          },
        })
        .catch(() => 0);
      const cadence =
        recentCount >= 6
          ? "Weekly"
          : recentCount >= 3
            ? "Biweekly"
            : recentCount >= 1
              ? "Monthly"
              : "Ad hoc";

      // Last topic from latest brief
      const lastBrief = await prisma.brief
        .findFirst({
          where: { people: { some: { personId: p.id } }, meeting: { userId } },
          include: { meeting: true },
          orderBy: { generatedAt: "desc" },
        })
        .catch(() => null);
      const lastTopic = lastBrief?.meeting?.title || null;

      return { p, nextStartsAt, cadence, lastTopic };
    }),
  );

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-4 text-2xl font-semibold">People</h1>
          <div className="mb-4">
            <PeopleSearch initialQuery={q} />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {enrich.map((
              {
                p,
                nextStartsAt,
                cadence,
                lastTopic,
              }: { p: any; nextStartsAt: Date | null; cadence: string; lastTopic: string | null },
            ) => (
              <Link
                key={p.id}
                href={`/people/${p.id}`}
                className="rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-border/20"
              >
                <div className="text-lg font-medium">
                  {p.name || p.email || "Unknown"}
                </div>
                {p.title || p.org ? (
                  <div className="text-sm text-muted-foreground">
                    {[p.title, p.org].filter(Boolean).join(" • ")}
                  </div>
                ) : null}
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>📅</span>
                    <span suppressHydrationWarning>
                      {nextStartsAt
                        ? `Next: ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(nextStartsAt)}`
                        : "Next: —"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>🕑</span>
                    <span>Meets: {cadence}</span>
                  </div>
                  <div className="flex items-center gap-2 text-primary">
                    <span>✓</span>
                    <span>
                      {openCountsByPerson[p.id] || 0} open action items
                    </span>
                  </div>
                  {lastTopic && (
                    <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                      Last topic: {lastTopic}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded-md border border-border px-3 py-1 text-sm">
                    ✉️ Email
                  </span>
                  <span className="rounded-md border border-border px-3 py-1 text-sm">
                    📆 Schedule
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
