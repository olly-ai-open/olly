import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Sidebar from "@/components/layout/sidebar";
import Link from "next/link";
import PersonEditor from "@/components/people/person-editor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PersonDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-sm text-muted-foreground">Sign in to view.</div>
      </main>
    );
  }
  const userId = session.user.id;
  const person = await prisma.person.findFirst({ where: { id, userId } });
  if (!person) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-sm text-muted-foreground">Person not found.</div>
      </main>
    );
  }
  const briefs = await prisma.brief.findMany({
    where: { people: { some: { personId: person.id } }, meeting: { userId } },
    orderBy: { generatedAt: "desc" },
    include: { meeting: true },
    take: 20,
  });

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold">
              {person.name || person.email || "Person"}
            </h1>
            {(person.title || person.org) && (
              <div className="text-sm text-muted-foreground">
                {[person.title, person.org].filter(Boolean).join(" • ")}
              </div>
            )}
          </div>

          <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-medium text-foreground">
              Edit details
            </h2>
            <PersonEditor
              personId={person.id}
              initialName={person.name}
              initialTitle={person.title}
              initialOrg={person.org}
            />
          </div>

          <div className="space-y-4">
            {briefs.map((b: any) => (
              <div
                key={b.id}
                className="rounded-lg border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">
                      {b.meeting?.title || "Brief"}
                    </div>
                    {b.meeting?.startsAt && (
                      <div
                        className="text-xs text-muted-foreground"
                        suppressHydrationWarning
                      >
                        {new Intl.DateTimeFormat("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(b.meeting.startsAt)}
                      </div>
                    )}
                  </div>
                  <Link className="text-sm underline" href={`/briefs/${b.id}`}>
                    Open
                  </Link>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {typeof b.content === "object" && (b.content as any)?.summary
                    ? (b.content as any).summary
                    : "(No summary)"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
