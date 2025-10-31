import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { unstable_noStore as noStore } from "next/cache";

export default async function BriefsList() {
  noStore();
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <p className="text-sm text-muted-foreground">Sign in to view briefs.</p>
    );
  }
  const briefs = await prisma.brief.findMany({
    where: { meeting: { userId: session.user.id } },
    orderBy: { generatedAt: "desc" },
    include: { meeting: true },
    take: 20,
  });
  if (!briefs.length)
    return (
      <p className="text-sm text-muted-foreground">No briefs generated yet.</p>
    );
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
      {briefs.map((b: any) => {
        const when = b.meeting?.startsAt
          ? format(b.meeting.startsAt, "PPpp")
          : "";
        const content = b.content as any;
        const text =
          typeof content === "string"
            ? content
            : content?.text || content?.summary || "(content)";
        return (
          <li key={b.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-medium">
                  {b.meeting?.title || "(Meeting)"}
                </div>
                <div className="text-xs text-muted-foreground">{when}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {b.confidence || ""}
              </div>
            </div>
            <div className="mt-3 text-sm whitespace-pre-wrap">{text}</div>
            <div className="mt-3">
              <a href={`/briefs/${b.id}`} className="text-sm underline">
                View brief →
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
