import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessTokenFromAccount, listEventsByDayWithToken } from "@/lib/google";
import { format } from "date-fns";
import { extractKeyBullets } from "@/lib/briefs";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import NextLocal from "@/components/next-local";

function formatMinutesHuman(mins: number) {
  if (!mins || mins < 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(" ") || "0m";
}

export default async function HomeDashboard({ day }: { day?: string }) {
  // Ensure fresh data on each request/navigation (meetings/briefs update frequently)
  noStore();
  const session = await auth();
  const user = session?.user as (typeof session.user & { id: string }) | undefined;
  const targetDay = day || new Date().toISOString().slice(0, 10);
  const meetings = user
    ? await (async () => {
        try {
          const account = await prisma.account.findFirst({ where: { userId: user.id, provider: "google" } });
          if (!account) return [] as Awaited<ReturnType<typeof listEventsByDayWithToken>>;
          const token = await getAccessTokenFromAccount(account);
          return listEventsByDayWithToken(token, targetDay);
        } catch {
          return [] as Awaited<ReturnType<typeof listEventsByDayWithToken>>;
        }
      })()
    : [];

  // Map existing meetings/briefs by Google event id for badge/status
  const byExternalId = user && meetings.length
    ? await (async () => {
        try {
          const ids = meetings.map((m) => m.id);
          const rows = await prisma.meeting.findMany({
            where: { userId: user.id, externalId: { in: ids } },
            include: { briefs: { orderBy: { generatedAt: "desc" }, take: 1 } },
          });
          const map = new Map<string, (typeof rows)[number]>(rows.map((r) => [r.externalId, r]));
          return map;
        } catch {
          return new Map<string, any>();
        }
      })()
    : new Map<string, any>();

  const meetingsToday = meetings.filter((m) => {
    const d = m.start ? new Date(m.start) : null;
    if (!d) return false;
    const cmp = new Date(targetDay + "T00:00:00");
    return d.getFullYear() === cmp.getFullYear() && d.getMonth() === cmp.getMonth() && d.getDate() === cmp.getDate();
  }).length;
  const briefsReady = Array.from(byExternalId.values()).filter((r) => (r as any)?.briefs?.length).length;
  const timeSavedMinutes = briefsReady * 30; // 30 minutes per brief
  const timeSavedLabel = formatMinutesHuman(timeSavedMinutes);

  // Next meeting label
  const upcomingSorted = meetings
    .map((m) => ({ m, d: m.start ? new Date(m.start) : null }))
    .filter((x) => x.d && x.d.getTime() >= Date.now())
    .sort((a, b) => (a.d!.getTime() - b.d!.getTime()));
  const nextISO = upcomingSorted.length ? upcomingSorted[0].d!.toISOString() : null;

  return (
    <div className="flex gap-6 mt-2">
      {/* Center column */}
      <div className="flex-1">
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
          <span>📊 {meetingsToday} meetings today</span>
          <span>• ✅ {briefsReady} briefs ready</span>
          {nextISO ? <NextLocal iso={nextISO} /> : null}
        </div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(() => {
              const current = new Date(`${targetDay}T00:00:00Z`);
              const prev = new Date(current.getTime() - 24*60*60*1000).toISOString().slice(0,10);
              const next = new Date(current.getTime() + 24*60*60*1000).toISOString().slice(0,10);
              const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(current);
              return (
                <>
                  <Link href={`/?date=${prev}`} className="rounded-md border border-border px-2 py-1 text-sm">◀</Link>
                  <div className="text-sm font-medium" suppressHydrationWarning>{label}</div>
                  <Link href={`/?date=${next}`} className="rounded-md border border-border px-2 py-1 text-sm">▶</Link>
                </>
              );
            })()}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-xl font-semibold text-primary">Upcoming Meetings</h2>
            {user ? (
              meetings.length ? (
                <ul className="divide-y divide-border">
                  {meetings.map((m) => {
                    const start = m.start ? new Date(m.start) : null;
                    const startStr = start ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(start) : "TBD";
                    // Optional preview from latest brief
                    const meetingRow = byExternalId.get(m.id);
                    const latest = meetingRow?.briefs?.[0];
                    const content: any = latest?.content as any;
                    const bullets = extractKeyBullets(content, 3);
                    return (
                      <li key={m.id} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{m.title}</div>
                            <div className="text-sm text-muted-foreground" suppressHydrationWarning>{startStr}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {latest ? (
                              <>
                                <span className="rounded-full bg-primary px-2 py-0.5 text-sm text-primary-foreground">Brief ready</span>
                                <a href={`/briefs/${latest.id}`} className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent">View</a>
                              </>
                            ) : (
                              <form action="/api/briefs/generate" method="post">
                                <input type="hidden" name="eventId" value={m.id} />
                                <input type="hidden" name="redirect" value="1" />
                                <button className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent" type="submit">Generate brief</button>
                              </form>
                            )}
                          </div>
                        </div>
                        {bullets.length ? (
                          <div className="mt-3 rounded-md bg-border/30 p-3 text-sm">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Key Context</div>
                            <ul className="list-disc space-y-1 pl-5">
                              {bullets.map((b, i) => (
                                <li key={i}>{b.replace(/^\s*[-•*]\s*/, '')}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No meetings in the next few hours.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">Sign in to view your upcoming meetings.</p>
            )}
          </div>
        </div>
      </div>

      {/* Right column */}
      <aside className="hidden w-80 shrink-0 lg:block">
        <div className="sticky top-6 space-y-4">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 text-sm font-medium">This Week</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Meetings:</span><span>{meetings.length}</span></div>
              <div className="flex justify-between"><span>Briefs delivered:</span><span>{briefsReady}</span></div>
              <div className="flex justify-between"><span>Time saved:</span><span>{timeSavedLabel}</span></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
