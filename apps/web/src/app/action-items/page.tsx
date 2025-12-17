import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/sidebar";
import ActionItemRow from "@/components/action-item-row";
import Link from "next/link";
import { getUserSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const items = await prisma.actionItem.findMany({
    where: { userId },
    include: {
      brief: { include: { people: { include: { person: true } } } },
      assignees: { include: { person: true } },
    },
    orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const now = new Date();
  const settings = await getUserSettings(userId);
  const timeZone = settings.timeZone || "UTC";
  const todayKey = toDayKeyInTimeZone(now, timeZone);

  const incomplete = items.filter((it: any) => !it.completedAt);
  const completed = items
    .filter((it: any) => !!it.completedAt)
    .sort(
      (a: any, b: any) =>
        new Date(b.completedAt as any).getTime() -
        new Date(a.completedAt as any).getTime(),
    );

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
    { key: "due", label: "Due", count: incomplete.length },
    { key: "completed", label: "Completed", count: completed.length },
  ];

  const activeTab = filter === "completed" ? "completed" : "due";

  const renderItems = (list: any[]) => (
    <div className="space-y-3">
      {list.map((ai: any) => {
        const options = (ai.brief?.people || [])
          .map((bp: any) => bp.person)
          .filter(Boolean) as any[];
        const assigned = (ai.assignees || [])
          .map((a: any) => a.person)
          .filter(Boolean) as any[];
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
            briefId={ai.briefId || null}
            assigned={assigned.map((p: any) => ({
              id: p.id,
              name: p.name,
              email: p.email,
            }))}
            options={options.map((p: any) => ({
              id: p.id,
              name: p.name,
              email: p.email,
            }))}
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
            completed.length ? (
              renderItems(completed)
            ) : (
              <div className="text-sm text-muted-foreground">
                No completed action items yet.
              </div>
            )
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
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
