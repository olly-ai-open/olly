import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type BriefJSON } from "@olly/core";
import {
  getAccessTokenFromAccount,
  listEventsByDayWithToken,
  checkGoogleHealth,
} from "@/lib/google";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import NextLocal from "@/components/next-local";
import GenerateBriefButton from "@/components/generate-brief-button";
import { getUserSettings } from "@/lib/settings";
import GenerateMorningBriefButton from "@/components/generate-morning-brief-button";
import GenerateEveningBriefButton from "@/components/generate-evening-brief-button";

function formatMinutesHuman(mins: number) {
  if (!mins || mins < 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(" ") || "0m";
}

function toLocalISODate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDueLabel(due: Date) {
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days <= -1) return "Overdue";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 7) return "Due this week";
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function actionTone(due: Date) {
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) {
    return {
      dot: "bg-destructive",
      container:
        "border-destructive/30 bg-destructive/10 text-destructive-foreground",
    };
  }
  if (days <= 3) {
    return {
      dot: "bg-warning",
      container: "border-warning/30 bg-warning/10 text-foreground",
    };
  }
  return {
    dot: "bg-accent",
    container: "border-accent/40 bg-accent/10 text-foreground",
  };
}

function formatTimeRange(
  start: Date | null,
  end: Date | null,
  timeZone: string,
) {
  if (!start || !end) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
  const startLabel = fmt.format(start);
  const endLabel = fmt.format(end);
  const durationMinutes = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / (60 * 1000)),
  );
  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  const duration =
    hours && mins ? `${hours}h ${mins}m` : hours ? `${hours}h` : `${mins}m`;
  return { label: `${startLabel} \u2013 ${endLabel}`, duration };
}

function formatAttendees(
  attendees?: { email?: string | null }[],
  currentEmail?: string | null,
) {
  const filtered = (attendees || [])
    .map((a) => a.email)
    .filter(Boolean)
    .filter((email) =>
      currentEmail ? email!.toLowerCase() !== currentEmail.toLowerCase() : true,
    );
  const names = filtered.slice(0, 2);
  if (!names.length) return null;
  const remaining = filtered.length - names.length;
  const tail = remaining > 0 ? ` +${remaining}` : "";
  return `${names.join(", ")}${tail}`;
}

export default async function HomeDashboard({ day }: { day?: string }) {
  // Ensure fresh data on each request/navigation (meetings/briefs update frequently)
  noStore();
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const userSettings = userId ? await getUserSettings(userId) : null;
  const timeZone = userSettings?.timeZone || "UTC";

  const now = new Date();
  const targetDay =
    day ||
    (timeZone
      ? (() => {
          const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          const parts = fmt.formatToParts(now);
          const obj: Record<string, string> = {};
          for (const p of parts) {
            if (p.type !== "literal") obj[p.type] = p.value;
          }
          return `${obj.year}-${obj.month}-${obj.day}`;
        })()
      : toLocalISODate(now));

  // Check if user has advanced Google scopes
  const googleHealth = userId ? await checkGoogleHealth(userId) : null;
  const meetings = userId
    ? await (async () => {
        try {
          const account = await prisma.account.findFirst({
            where: { userId, provider: "google" },
          });
          if (!account)
            return [] as Awaited<ReturnType<typeof listEventsByDayWithToken>>;

          // Check if user has calendar scope
          const hasCalendarScope = account.scope?.includes("calendar.readonly");
          if (!hasCalendarScope) {
            // User only has basic auth, no calendar access
            return [] as Awaited<ReturnType<typeof listEventsByDayWithToken>>;
          }

          const token = await getAccessTokenFromAccount(account);
          return listEventsByDayWithToken(token, targetDay, timeZone);
        } catch (error: any) {
          if (error?.message === "REAUTH_REQUIRED") {
            console.log("Calendar access requires re-authentication");
          }
          return [] as Awaited<ReturnType<typeof listEventsByDayWithToken>>;
        }
      })()
    : [];

  // Map existing meetings/briefs by Google event id for badge/status
  const byExternalId =
    userId && meetings.length
      ? await (async () => {
          try {
            const ids = meetings.map((m) => m.id);
            const rows = await prisma.meeting.findMany({
              where: { userId, externalId: { in: ids } },
              include: {
                briefs: { orderBy: { generatedAt: "desc" }, take: 1 },
              },
            });
            const map = new Map<string, (typeof rows)[number]>(
              rows.map((r: any) => [r.externalId, r]),
            );
            return map;
          } catch {
            return new Map<string, any>();
          }
        })()
      : new Map<string, any>();

  const meetingsToday = meetings.length;
  const briefsReady = Array.from(byExternalId.values()).filter(
    (r) => (r as any)?.briefs?.length,
  ).length;
  const timeSavedMinutes = briefsReady * 30; // 30 minutes per brief
  const timeSavedLabel = formatMinutesHuman(timeSavedMinutes);

  // Next meeting label
  const upcomingSorted = meetings
    .map((m) => ({ m, d: m.start ? new Date(m.start) : null }))
    // eslint-disable-next-line react-hooks/purity -- Server component: snapshot request-time "now" for filtering upcoming events
    .filter((x) => x.d && x.d.getTime() >= Date.now())
    .sort((a, b) => a.d!.getTime() - b.d!.getTime());
  const nextISO = upcomingSorted.length
    ? upcomingSorted[0].d!.toISOString()
    : null;

  const morningExternalId = `morning:${targetDay}`;
  const morningMeeting =
    userId && googleHealth?.hasAdvancedScopes
      ? await prisma.meeting.findFirst({
          where: { userId, externalId: morningExternalId },
          include: {
            briefs: { orderBy: { generatedAt: "desc" }, take: 1 },
          },
        })
      : null;
  const morningBriefId = (morningMeeting as any)?.briefs?.[0]?.id ?? null;

  const eveningExternalId = `evening:${targetDay}`;
  const eveningMeeting =
    userId && googleHealth?.hasAdvancedScopes
      ? await prisma.meeting.findFirst({
          where: { userId, externalId: eveningExternalId },
          include: {
            briefs: { orderBy: { generatedAt: "desc" }, take: 1 },
          },
        })
      : null;
  const eveningBriefId = (eveningMeeting as any)?.briefs?.[0]?.id ?? null;
  const eveningBriefTimeIso = `${targetDay}T23:59:59Z`;

  const actionItems = userId
    ? await prisma.actionItem.findMany({
        where: { userId, completedAt: null, dueAt: { not: null } },
        orderBy: { dueAt: "asc" },
        take: 4,
        select: { id: true, title: true, dueAt: true },
      })
    : [];

  return (
    <div className="mt-0 flex items-start gap-6">
      {/* Center column */}
      <div className="flex-1">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card bg-gradient-brand-light">
            <div className="text-sm font-medium text-muted-foreground">
              Today
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-3xl font-semibold">{meetingsToday}</span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Meetings
              </span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {briefsReady} briefs ready
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card bg-gradient-brand-light">
            <div className="text-sm font-medium text-muted-foreground">
              Time saved
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-3xl font-semibold">{timeSavedLabel}</span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Estimate
              </span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              Based on delivered briefs
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card bg-gradient-brand-light">
            <div className="text-sm font-medium text-muted-foreground">
              Next meeting
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span
                className={`${nextISO ? "text-3xl" : "text-3xl"} font-semibold`}
              >
                {nextISO ? (
                  <NextLocal iso={nextISO} timeZone={timeZone} />
                ) : (
                  "--"
                )}
              </span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {nextISO ? "Get a fresh brief" : "No upcoming events"}
            </div>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/80 px-4 py-3 shadow-card">
          <div className="flex items-center gap-3">
            {(() => {
              const current = new Date(`${targetDay}T00:00:00`);
              const prev = toLocalISODate(
                new Date(current.getTime() - 24 * 60 * 60 * 1000),
              );
              const next = toLocalISODate(
                new Date(current.getTime() + 24 * 60 * 60 * 1000),
              );
              const label = new Intl.DateTimeFormat("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(current);
              return (
                <>
                  <Link
                    href={`/?date=${prev}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-muted text-sm font-semibold text-foreground hover:bg-accent/50"
                  >
                    <span aria-hidden="true">‹</span>
                    <span className="sr-only">Previous day</span>
                  </Link>
                  <div
                    className="text-base font-semibold"
                    suppressHydrationWarning
                  >
                    {label}
                  </div>
                  <Link
                    href={`/?date=${next}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-muted text-sm font-semibold text-foreground hover:bg-accent/50"
                  >
                    <span aria-hidden="true">›</span>
                    <span className="sr-only">Next day</span>
                  </Link>
                </>
              );
            })()}
          </div>
          <div>
            {userId && (
              <div className="flex items-center gap-2">
                <GenerateMorningBriefButton
                  day={targetDay}
                  existingBriefId={morningBriefId}
                />
                <GenerateEveningBriefButton
                  existingBriefId={eveningBriefId}
                  briefTime={eveningBriefTimeIso}
                  windowHours={24}
                />
              </div>
            )}
          </div>
        </div>

        {/* Show a notice if user doesn't have advanced scopes */}
        {userId && googleHealth && !googleHealth.hasAdvancedScopes && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <span className="text-amber-600">⚠️</span>
              <div className="flex-1">
                <div className="font-medium text-amber-900">
                  Connect Google Workspace to see your meetings
                </div>
                <div className="mt-1 text-sm text-amber-700">
                  You&apos;re signed in, but we need additional permissions to
                  access your calendar, drive, and email for meeting briefs.
                </div>
                <Link
                  href="/integrations"
                  className="mt-3 inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Connect Google Workspace →
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          {userId ? (
            meetings.length ? (
              <div className="space-y-4">
                {meetings.map((m) => {
                  const start = m.start ? new Date(m.start) : null;
                  const end = m.end ? new Date(m.end) : null;
                  const timeRange = formatTimeRange(start, end, timeZone);
                  const attendeeLabel = formatAttendees(
                    m.attendees,
                    session?.user?.email ?? null,
                  );
                  const meetingRow = byExternalId.get(m.id);
                  const latest = meetingRow?.briefs?.[0];
                  const content = latest?.content as BriefJSON;
                  const bullets = content?.key_context || [];
                  return (
                    <div
                      key={m.id}
                      className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-card ring-1 ring-border/40 hover:shadow-card-hover hover:border-secondary/30 transition-all duration-300"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-semibold text-foreground">
                              {m.title}
                            </span>
                            {latest ? (
                              <span className="rounded-full bg-success/15 px-2 py-1 text-xs font-semibold text-success shadow-card">
                                Brief ready
                              </span>
                            ) : null}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {timeRange ? (
                              <>
                                <span>{timeRange.label}</span>
                                <span className="text-muted-foreground">
                                  {" "}
                                  ({timeRange.duration})
                                </span>
                              </>
                            ) : null}
                            {attendeeLabel ? (
                              <>
                                <br />
                                <span className="text-muted-foreground">
                                  with: {attendeeLabel}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {latest ? (
                            <a
                              href={`/briefs/${latest.id}`}
                              className="rounded-md border border-border/80 bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground shadow-card hover:opacity-90"
                            >
                              View Full Brief
                            </a>
                          ) : (
                            <GenerateBriefButton eventId={m.id} />
                          )}
                        </div>
                      </div>
                      {bullets.length ? (
                        <div className="mt-4 rounded-2xl border border-border/50 bg-gradient-brand-light p-4 text-sm shadow-card">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Key Context
                          </div>
                          <ul className="list-disc space-y-1 pl-5 text-foreground">
                            {bullets.map((b, i) => (
                              <li key={i}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No meetings in the next few hours.
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Sign in to view your upcoming meetings.
            </p>
          )}
        </div>
      </div>

      {/* Right column */}
      <aside className="hidden w-80 shrink-0 lg:block lg:sticky lg:top-4 lg:self-start -mt-15">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-gradient-brand-light p-4 shadow-card">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              This week
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Meetings</span>
                <span className="text-lg font-semibold text-foreground">
                  {meetings.length}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Briefs delivered</span>
                <span className="text-lg font-semibold text-foreground">
                  {briefsReady}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Time saved</span>
                <span className="text-lg font-semibold text-foreground">
                  {timeSavedLabel}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Upcoming action items
              </div>
              <Link
                href="/action-items"
                className="text-xs font-semibold text-primary hover:underline"
              >
                View all
              </Link>
            </div>
            {actionItems.length ? (
              <div className="space-y-3">
                {actionItems.map((item) => {
                  const due = item.dueAt ? new Date(item.dueAt) : null;
                  if (!due) return null;
                  const tone = actionTone(due);
                  return (
                    <div
                      key={item.id}
                      className={`rounded-xl border px-3 py-3 text-sm shadow-card ${tone.container}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${tone.dot}`}
                          />
                          <div>
                            <div className="font-semibold text-foreground">
                              {item.title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatDueLabel(due)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                No upcoming action items.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
