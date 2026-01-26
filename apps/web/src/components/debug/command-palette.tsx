"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type PersonResult = {
  id: string;
  name: string | null;
  email: string | null;
  title: string | null;
  org: string | null;
};

type MeetingResult = {
  id: string;
  title: string;
  startsAt: string | null;
  briefs: { id: string }[];
};

type BriefResult = {
  id: string;
  generatedAt: string;
  meeting: { id: string; title: string | null; startsAt: string | null };
};

type SearchPayload = {
  people: PersonResult[];
  meetings: MeetingResult[];
  briefs: BriefResult[];
};

const toISODate = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateQuery = (raw: string) => {
  const input = raw.trim().toLowerCase();
  if (!input) return null;

  const now = new Date();

  if (input === "today") {
    return { label: "Today", date: toISODate(now) };
  }
  if (input === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { label: "Yesterday", date: toISODate(d) };
  }
  if (input === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { label: "Tomorrow", date: toISODate(d) };
  }

  const weekMap: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };

  const weekdayMatch = input.match(
    /^(last|next)\s+(sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat)$/,
  );
  if (weekdayMatch) {
    const [, dir, day] = weekdayMatch;
    const target = weekMap[day];
    const current = now.getDay();
    const offset =
      dir === "next"
        ? (7 - current + target) % 7 || 7
        : (current + 7 - target) % 7 || 7;
    const d = new Date(now);
    d.setDate(d.getDate() + (dir === "next" ? offset : -offset));
    return { label: `${dir} ${day}`, date: toISODate(d) };
  }

  const isoMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return { label: isoMatch[0], date: toISODate(d) };
    }
  }

  const slashMatch = input.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = slashMatch[3]
      ? Number(
          slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3],
        )
      : now.getFullYear();
    const d = new Date(year, month - 1, day);
    if (!Number.isNaN(d.getTime())) {
      return {
        label: `${month}/${day}/${year}`,
        date: toISODate(d),
      };
    }
  }

  return null;
};

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchPayload>({
    people: [],
    meetings: [],
    briefs: [],
  });
  const [loading, setLoading] = useState(false);

  const dateSuggestions = useMemo(() => {
    const parsed = parseDateQuery(query);
    if (parsed) {
      return [
        {
          id: `date-${parsed.date}`,
          label: `Jump to ${parsed.label}`,
          secondary: parsed.date,
          href: `/?date=${parsed.date}`,
        },
      ];
    }

    if (query.trim()) return [];

    const base = new Date();
    const days = [
      { label: "Today", offset: 0 },
      { label: "Yesterday", offset: -1 },
      { label: "Tomorrow", offset: 1 },
    ];
    return days.map((d) => {
      const dt = new Date(base);
      dt.setDate(dt.getDate() + d.offset);
      const date = toISODate(dt);
      return {
        id: `date-${d.label.toLowerCase()}`,
        label: `Jump to ${d.label}`,
        secondary: date,
        href: `/?date=${date}`,
      };
    });
  }, [query]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const id = setTimeout(async () => {
      if (!query.trim()) {
        setResults({ people: [], meetings: [], briefs: [] });
        return;
      }
      setLoading(true);
      try {
        const url = `/api/command-search?q=${encodeURIComponent(query.trim())}`;
        const resp = await fetch(url as RequestInfo, {
          signal: controller.signal,
        });
        if (resp.ok) {
          const data = (await resp.json()) as SearchPayload;
          setResults(data);
        } else {
          setResults({ people: [], meetings: [], briefs: [] });
        }
      } catch {
        setResults({ people: [], meetings: [], briefs: [] });
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(id);
    };
  }, [query, open]);

  const grouped = useMemo(() => {
    const sections: {
      title: string;
      items: {
        id: string;
        label: string;
        secondary?: string;
        href?: string;
        disabled?: boolean;
      }[];
    }[] = [];

    if (dateSuggestions.length) {
      sections.push({
        title: "Navigation",
        items: dateSuggestions,
      });
    }

    if (results.people.length) {
      sections.push({
        title: "People",
        items: results.people.map((p) => ({
          id: `person-${p.id}`,
          label: p.name || p.email || "Unknown",
          secondary: [p.title, p.org, p.email].filter(Boolean).join(" • "),
          href: `/people/${p.id}`,
        })),
      });
    }

    if (results.meetings.length) {
      sections.push({
        title: "Meetings",
        items: results.meetings.map((m) => {
          const briefId = m.briefs?.[0]?.id;
          return {
            id: `meeting-${m.id}`,
            label: m.title,
            secondary: m.startsAt
              ? new Date(m.startsAt).toLocaleString()
              : undefined,
            href: briefId ? `/briefs/${briefId}` : undefined,
            disabled: !briefId,
          };
        }),
      });
    }

    if (results.briefs.length) {
      sections.push({
        title: "Briefs",
        items: results.briefs.map((b) => ({
          id: `brief-${b.id}`,
          label: b.meeting?.title || "Brief",
          secondary: new Date(b.generatedAt).toLocaleString(),
          href: `/briefs/${b.id}`,
        })),
      });
    }

    return sections;
  }, [dateSuggestions, results]);

  const onSelect = (href?: string) => {
    if (!href) return;
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm transition hover:border-primary hover:text-foreground md:inline-flex"
        >
          <span className="text-foreground">⌘K</span>
          <span className="text-xs text-muted-foreground">Command palette</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-xs text-muted-foreground shadow-sm transition hover:border-primary hover:text-foreground md:hidden"
          aria-label="Open command palette"
        >
          ⋮
        </button>
      </div>

      {open && mounted
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/50 px-4 py-6 backdrop-blur-sm md:py-10">
              <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl">
                <div className="flex items-center border-b border-border px-3 py-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search meetings, people, briefs…"
                    className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {loading && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="ml-3 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Esc
                  </button>
                </div>

                <div className="max-h-[60vh] overflow-y-auto px-2 py-2">
                  {grouped.length === 0 && !loading ? (
                    <div className="px-3 py-6 text-sm text-muted-foreground">
                      {query
                        ? "No results."
                        : "Type to search meetings and people."}
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    {grouped.map((section) => (
                      <div key={section.title}>
                        <div className="px-3 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
                          {section.title}
                        </div>
                        <ul className="divide-y divide-border rounded-md border border-border bg-card/60">
                          {section.items.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => onSelect(item.href)}
                                disabled={item.disabled}
                                className={[
                                  "flex w-full items-start gap-3 px-3 py-3 text-left transition",
                                  item.disabled
                                    ? "cursor-not-allowed text-muted-foreground/60"
                                    : "hover:bg-accent/30",
                                ].join(" ")}
                              >
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-foreground">
                                    {item.label}
                                  </div>
                                  {item.secondary ? (
                                    <div className="text-xs text-muted-foreground">
                                      {item.secondary}
                                    </div>
                                  ) : null}
                                </div>
                                {!item.disabled && (
                                  <span className="text-xs text-primary">
                                    ↵
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
