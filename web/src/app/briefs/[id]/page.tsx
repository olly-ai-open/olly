import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import BriefActions from "@/components/brief-actions";
import BackButton from "@/components/back-button";
import ActionItemRow from "@/components/action-item-row";
import MarkdownView from "@/components/markdown-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BriefDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-4 text-2xl font-semibold">Brief</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to view this brief.
        </p>
      </div>
    );
  }

  const brief = await prisma.brief.findUnique({
    where: { id },
    include: {
      meeting: true,
      actionItems: { include: { assignees: { include: { person: true } } } },
      people: { include: { person: true } },
    },
  });
  if (!brief || brief.meeting?.userId !== session.user.id) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-4 text-2xl font-semibold">Brief</h1>
        <p className="text-sm text-muted-foreground">Brief not found.</p>
      </div>
    );
  }
  const when = brief.meeting?.startsAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(brief.meeting.startsAt)
    : "";
  const content: any = brief.content as any;
  const contentObj: any | null =
    typeof content === "object" && content ? content : null;
  const text = !contentObj
    ? typeof content === "string"
      ? content
      : String(content ?? "")
    : "";
  const sources: string[] = Array.isArray(brief.sources)
    ? (brief.sources as any[])
    : [];

  function parseSource(s: string): {
    title: string;
    url?: string;
    provider?: string;
    meta?: string;
  } {
    // Accept formats like: "Drive: Title -> URL" or Gmail URL strings
    const driveMatch = s.match(/^\s*(\w+):\s*(.*?)\s*->\s*(https?:\/\/\S+)/i);
    if (driveMatch)
      return {
        provider: driveMatch[1],
        title: driveMatch[2],
        url: driveMatch[3],
      };
    const urlMatch = s.match(/https?:\/\/\S+/);
    return {
      title: s.replace(urlMatch?.[0] ?? "", "").trim() || "Link",
      url: urlMatch?.[0],
    };
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {brief.meeting?.title || "Brief"}
          </h1>
          <div
            className="text-sm text-muted-foreground"
            suppressHydrationWarning
          >
            {when}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Report (markdown displayed as preformatted text) */}
        <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
          {contentObj?.brief_markdown ? (
            <MarkdownView
              markdown={contentObj.brief_markdown}
              className="prose prose-sm max-w-none"
            />
          ) : (
            <div className="whitespace-pre-wrap text-sm">{text}</div>
          )}
        </div>

        {/* Relevant Documents */}
        {sources?.length ? (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 text-lg font-semibold">Relevant Documents</div>
            <ul className="space-y-2">
              {sources.slice(0, 10).map((s, i) => {
                const p = parseSource(s);
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
                  >
                    <div>
                      <div className="font-medium">{p.title}</div>
                      {p.provider && (
                        <div className="text-xs text-muted-foreground">
                          {p.provider}
                        </div>
                      )}
                    </div>
                    {p.url && (
                      <a
                        className="rounded-md border border-border px-3 py-1 text-sm hover:bg-border/30"
                        href={p.url}
                        target="_blank"
                      >
                        Open
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* Action Items */}
        {Array.isArray(brief.actionItems) && brief.actionItems.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 text-sm font-medium">Action Items</div>
            <ul className="space-y-1 text-sm">
              {brief.actionItems.map((ai: any) => {
                const assigned = (ai.assignees || [])
                  .map((a: any) => a.person)
                  .filter(Boolean) as any[];
                const options = (brief.people || [])
                  .map((bp: any) => bp.person)
                  .filter(Boolean) as any[];
                return (
                  <li key={ai.id}>
                    <ActionItemRow
                      id={ai.id}
                      title={ai.title}
                      completedAt={
                        ai.completedAt
                          ? new Date(ai.completedAt as any).toISOString()
                          : null
                      }
                      status={ai.status}
                      dueAt={
                        ai.dueAt
                          ? new Date(ai.dueAt as any).toISOString()
                          : null
                      }
                      briefId={brief.id}
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
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Olly's Take: omitted under new format (content.brief_markdown covers it) */}

        {/* Actions */}
        <BriefActions briefId={brief.id} readAt={brief.readAt ?? null} />
      </div>

      {sources?.length ? (
        <div className="mt-4">
          <div className="mb-2 text-sm font-medium">Sources</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {sources.slice(0, 10).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6">
        <BackButton />
      </div>
    </div>
  );
}
