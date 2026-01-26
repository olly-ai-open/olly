import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/layout/sidebar";
import ActionItemRow from "@/components/action-items/action-item-row";
import Link from "next/link";
import { getUserSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 20;

function toDayKeyInTimeZone(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return `${obj.year}-${obj.month}-${obj.day}`;
}

export default async function ActionItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-sm text-muted-foreground">
          Sign in to view action items.
        </div>
      </main>
    );
  }
  const userId = session.user.id;
  const sp = await searchParams;
  const filter =
    (Array.isArray(sp?.filter) ? sp.filter[0] : sp?.filter) || "due";
  const pageParam = Array.isArray(sp?.page) ? sp.page[0] : sp?.page;
  const page = Math.max(1, Number(pageParam) || 1);

  const activeTab = filter === "completed" ? "completed" : "due";
  const baseWhere = { userId, NOT: { status: "deleted" as const } };

  const [dueCount, completedCount, items] = await Promise.all([
    prisma.actionItem.count({
      where: { ...baseWhere, completedAt: null },
    }),
    prisma.actionItem.count({
      where: { ...baseWhere, completedAt: { not: null } },
    }),
    prisma.actionItem.findMany({
      where:
        activeTab === "completed"
          ? { ...baseWhere, completedAt: { not: null } }
          : { ...baseWhere, completedAt: null },
      include: {
        brief: { include: { people: { include: { person: true } } } },
        assignees: { include: { person: true } },
      },
      orderBy:
        activeTab === "completed"
          ? [{ completedAt: "desc" }, { createdAt: "desc" }]
          : [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const now = new Date();
  const settings = await getUserSettings(userId);
  const timeZone = settings.timeZone || "UTC";
  const todayKey = toDayKeyInTimeZone(now, timeZone);

  const incomplete = items.filter((it: any) => !it.completedAt);
  const completed = items.filter((it: any) => !!it.completedAt);

  const overdue = incomplete.filter((it: any) => {
    if (!it.dueAt) return false;
    const dueKey = toDayKeyInTimeZone(new Date(it.dueAt), timeZone);
    return dueKey < todayKey;
  });
  const dueToday = incomplete.filter((it: any) => {
    if (!it.dueAt) return false;
    const dueKey = toDayKeyInTimeZone(new Date(it.dueAt), timeZone);
    return dueKey === todayKey;
  });
  const upcoming = incomplete.filter((it: any) => {
    if (!it.dueAt) return false;
    const dueKey = toDayKeyInTimeZone(new Date(it.dueAt), timeZone);
    return dueKey > todayKey;
  });
  const noDueDate = incomplete.filter((it: any) => !it.dueAt);

  const tabs = [
    { key: "due", label: "Due", count: dueCount },
    { key: "completed", label: "Completed", count: completedCount },
  ];

  const renderItems = (list: any[]) => (
    <div className="space-y-3">
      {list.map((ai: any) => {
        return (
          <ActionItemRow
            key={ai.id}
            id={ai.id}
            title={ai.title}
            completedAt={
              ai.completedAt
                ? new Date(ai.completedAt as any).toISOString()
                : null
            }
            status={ai.status}
            dueAt={ai.dueAt ? new Date(ai.dueAt as any).toISOString() : null}
            timeZone={timeZone}
            briefId={ai.briefId || null}
          />
        );
      })}
    </div>
  );

  const renderSection = (
    title: string,
    list: any[],
    opts?: { emptyText?: string },
  ) => {
    const emptyText = opts?.emptyText ?? "No items.";
    return (
      <details
        open={list.length > 0}
        className="rounded-md border border-border bg-card/40"
      >
        <summary className="flex cursor-pointer list-none items-baseline justify-between px-3 py-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="text-xs text-muted-foreground">{list.length}</span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
          {list.length ? (
            renderItems(list)
          ) : (
            <div className="text-sm text-muted-foreground">{emptyText}</div>
          )}
        </div>
      </details>
    );
  };

  const totalForTab = activeTab === "completed" ? completedCount : dueCount;
  const totalPages = Math.max(1, Math.ceil(totalForTab / PAGE_SIZE));
  const prevPage = page > 1 ? page - 1 : null;
  const nextPage = page < totalPages ? page + 1 : null;
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams();
    if (activeTab === "completed") params.set("filter", "completed");
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/action-items?${qs}` : "/action-items";
  };

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-4 text-2xl font-semibold">Action Items</h1>
          <div className="mb-4 flex items-center gap-2">
            {tabs.map((t: { key: string; label: string; count: number }) => (
              <Link
                key={t.key}
                href={
                  t.key === "due"
                    ? "/action-items"
                    : `/action-items?filter=${t.key}`
                }
                className={`rounded-md px-3 py-1 text-sm border ${
                  activeTab === t.key
                    ? "bg-accent/60 text-primary border-border"
                    : "border-border hover:bg-border/30"
                }`}
              >
                {t.label}{" "}
                <span className="text-xs text-muted-foreground">
                  ({t.count})
                </span>
              </Link>
            ))}
          </div>

          {activeTab === "completed" ? (
            <div className="space-y-6">
              {completed.length ? (
                renderItems(completed)
              ) : (
                <div className="text-sm text-muted-foreground">
                  No completed action items yet.
                </div>
              )}
              {totalPages > 1 ? (
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    {prevPage ? (
                      <Link
                        href={pageHref(prevPage)}
                        className="rounded-md border border-border px-3 py-1 hover:bg-border/30"
                      >
                        Previous
                      </Link>
                    ) : null}
                    {nextPage ? (
                      <Link
                        href={pageHref(nextPage)}
                        className="rounded-md border border-border px-3 py-1 hover:bg-border/30"
                      >
                        Next
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-8">
              {!incomplete.length ? (
                <div className="text-sm text-muted-foreground">
                  No open action items right now.
                </div>
              ) : null}
              {renderSection("Overdue", overdue, {
                emptyText: "No overdue items.",
              })}
              {renderSection("Today", dueToday, {
                emptyText: "Nothing due today.",
              })}
              {renderSection("Upcoming", upcoming, {
                emptyText: "No upcoming due dates.",
              })}
              {renderSection("No due date", noDueDate, {
                emptyText: "No undated items.",
              })}
              {totalPages > 1 ? (
                <div className="flex items-center justify-between text-sm">
                  <div className="text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    {prevPage ? (
                      <Link
                        href={pageHref(prevPage)}
                        className="rounded-md border border-border px-3 py-1 hover:bg-border/30"
                      >
                        Previous
                      </Link>
                    ) : null}
                    {nextPage ? (
                      <Link
                        href={pageHref(nextPage)}
                        className="rounded-md border border-border px-3 py-1 hover:bg-border/30"
                      >
                        Next
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
