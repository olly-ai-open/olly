import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/sidebar";
import ActionItemRow from "@/components/action-item-row";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
    (Array.isArray(sp?.filter) ? sp.filter[0] : sp?.filter) || "today";

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
  const weekEnd = new Date(
    now.getTime() + (7 - now.getDay()) * 24 * 60 * 60 * 1000,
  );
  const filtered = items.filter((it: any) => {
    const done = !!it.completedAt;
    const due = it.dueAt ? new Date(it.dueAt) : null;
    switch (filter) {
      case "today":
        return !done && due && isSameDay(due, now);
      case "week":
        return !done && due && due > now && due <= weekEnd;
      case "overdue":
        return !done && due && due < now && !isSameDay(due, now);
      case "completed":
        return done;
      default:
        return true;
    }
  });

  const tabs = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Due Today" },
    { key: "week", label: "Due This Week" },
    { key: "completed", label: "Completed" },
    { key: "all", label: "All" },
  ];

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-4 text-2xl font-semibold">Action Items</h1>
          <div className="mb-4 flex items-center gap-2">
            {tabs.map((t: { key: string; label: string }) => (
              <Link
                key={t.key}
                href={
                  t.key === "today"
                    ? "/action-items"
                    : `/action-items?filter=${t.key}`
                }
                className={`rounded-md px-3 py-1 text-sm border ${filter === t.key ? "bg-accent/60 text-primary border-border" : "border-border hover:bg-border/30"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.map((ai: any) => {
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
                  dueAt={
                    ai.dueAt ? new Date(ai.dueAt as any).toISOString() : null
                  }
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
        </div>
      </div>
    </main>
  );
}
