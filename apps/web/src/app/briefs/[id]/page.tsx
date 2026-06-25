import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import BriefActions from "@/components/briefs/brief-actions";
import BackButton from "@/components/layout/back-button";
import ActionItemRow from "@/components/action-items/action-item-row";
import MarkdownView from "@/components/briefs/markdown-view";
import { getUserSettings } from "@/lib/settings";
import { getBriefForUser } from "@/lib/briefs";
import {
  parseMeetingBriefSections,
  parseOverviewContent,
  sanitizeBriefMarkdown,
} from "@/lib/parse-meeting-brief-sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Olly - Brief",
  description: "Brief",
};

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
  const settings = await getUserSettings(session.user.id);

  const brief = await getBriefForUser({
    id,
    userId: session.user.id,
    markRead: true,
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
        timeZone: settings.timeZone || "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(brief.meeting.startsAt)
    : "";

  // Parse content — it may be a JSON string (from encryption layer) or already an object
  const rawContent: any = brief.content as any;
  let contentObj: any | null = null;
  if (typeof rawContent === "object" && rawContent) {
    contentObj = rawContent;
  } else if (typeof rawContent === "string") {
    try {
      const parsed = JSON.parse(rawContent);
      if (typeof parsed === "object" && parsed) {
        contentObj = parsed;
      }
    } catch {
      // not valid JSON, treat as plain text
    }
  }
  const text = !contentObj
    ? typeof rawContent === "string"
      ? rawContent
      : String(rawContent ?? "")
    : "";

  const goals: string[] = Array.isArray(contentObj?.goals)
    ? (contentObj.goals as any[])
        .map((g: any) => (typeof g === "string" ? g.trim() : ""))
        .filter(Boolean)
    : [];

  // Parse sources — also stored as JSON string
  const rawSources: any = brief.sources as any;
  let parsedSources: string[] = [];
  if (Array.isArray(rawSources)) {
    parsedSources = rawSources as string[];
  } else if (typeof rawSources === "string") {
    try {
      const s = JSON.parse(rawSources);
      if (Array.isArray(s)) parsedSources = s;
    } catch {
      // ignore
    }
  }
  const sources: string[] = parsedSources;

  const highlightedIds: string[] = Array.isArray(
    contentObj?.highlighted_action_item_ids,
  )
    ? (contentObj.highlighted_action_item_ids as any[])
        .filter((x: any) => typeof x === "string" && x.trim())
        .map((x: string) => x.trim())
    : [];
  const isMorningBrief = brief.meeting?.type === "morning";
  const isEveningBrief = brief.meeting?.type === "evening";
  const isMeetingBrief = !isMorningBrief && !isEveningBrief;

  const briefMarkdown = contentObj?.brief_markdown
    ? sanitizeBriefMarkdown(contentObj.brief_markdown)
    : null;

  const meetingSections =
    isMeetingBrief && briefMarkdown
      ? parseMeetingBriefSections(briefMarkdown)
      : null;

  const highlightedActionItems =
    isMorningBrief && highlightedIds.length
      ? await prisma.actionItem.findMany({
          where: {
            userId: session.user.id,
            id: { in: highlightedIds },
            NOT: { status: "deleted" },
          },
          include: {
            assignees: { include: { person: true } },
            brief: {
              include: {
                people: { include: { person: true } },
              },
            },
          },
        })
      : [];

  function parseSource(s: string): {
    title: string;
    url?: string;
    provider?: string;
    meta?: string;
  } {
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
        {meetingSections ? (
          <>
            {meetingSections.overview &&
              (() => {
                const ov = parseOverviewContent(meetingSections.overview);
                return (
                  <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                    <MarkdownView
                      markdown={ov.mainContent}
                      className="prose prose-sm max-w-none"
                    />
                    {ov.attendees && (
                      <details className="mt-3 border-t border-border pt-3">
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                          Attendees
                        </summary>
                        <div className="mt-2">
                          <MarkdownView
                            markdown={ov.attendees}
                            className="prose prose-sm max-w-none"
                          />
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}

            {meetingSections.contextAndPoints && (
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <MarkdownView
                  markdown={meetingSections.contextAndPoints}
                  className="prose prose-sm max-w-none"
                />
              </div>
            )}

            {!meetingSections.overview && !meetingSections.contextAndPoints && (
              <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <MarkdownView
                  markdown={meetingSections.fullMarkdown}
                  className="prose prose-sm max-w-none"
                />
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            {briefMarkdown ? (
              <MarkdownView
                markdown={briefMarkdown}
                className="prose prose-sm max-w-none"
              />
            ) : (
              <div className="whitespace-pre-wrap text-sm">{text}</div>
            )}
          </div>
        )}

        {goals.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <h2 className="text-xl font-semibold mb-2">
              Goals for this meeting
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {goals.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        )}

        {sources?.length ? (
          <details
            className="group rounded-lg border border-border bg-card shadow-sm"
            defaultValue={undefined}
          >
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">
                  Relevant Documents
                </span>
                <span
                  className="text-muted-foreground transition-transform duration-150 group-open:rotate-90"
                  aria-hidden
                >
                  ▸
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {sources.length} item{sources.length === 1 ? "" : "s"}
              </span>
            </summary>
            <div className="border-t border-border px-4 py-4">
              <ul className="space-y-2">
                {sources.slice(0, 10).map((s, i) => {
                  const p = parseSource(s);
                  return (
                  <li
                      key={i}
                      className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
                      <div>
                        <div className="font-medium">{p.title}</div>
                        {p.provider && (
                          <div className="text-xs text-muted-foreground capitalize">
                            {p.provider}
                          </div>
                        )}
                      </div>
                      {p.url && (
                        <a
                          className="rounded-md border border-border px-3 py-1 text-sm hover:bg-border/30"
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        ) : null}

        {isMorningBrief && highlightedActionItems.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 text-sm font-medium">All Action Items</div>
            <ul className="space-y-1 text-sm">
              {highlightedActionItems.map((ai: any) => {
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
                      timeZone={settings.timeZone || "UTC"}
                      briefId={ai.briefId || null}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        ) : Array.isArray(brief.actionItems) && brief.actionItems.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 text-sm font-medium">Action Items</div>
            <ul className="space-y-1 text-sm">
              {brief.actionItems
                .filter((ai: any) => ai?.status !== "deleted")
                .map((ai: any) => {
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
                        timeZone={settings.timeZone || "UTC"}
                        briefId={brief.id}
                      />
                    </li>
                  );
                })}
            </ul>
          </div>
        ) : null}

        <BriefActions briefId={brief.id} />
      </div>

      <div className="mt-6">
        <BackButton />
      </div>
    </div>
  );
}
