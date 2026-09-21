"use client";

import Link from "next/link";
import { useState } from "react";

type DraftAttendee = { email: string; name: string; required: boolean };

type Draft = {
  title: string;
  durationMinutes: number;
  windowStartDate: string; // YYYY-MM-DD (local)
  windowEndDate: string; // YYYY-MM-DD (local, inclusive)
  timeOfDay: "morning" | "afternoon" | "evening" | "any";
  notes: string;
  /** True when the time is already agreed and should be booked directly. */
  fixedTime: boolean;
  /** datetime-local value (local time) used when fixedTime is on. */
  fixedStart: string;
  attendees: DraftAttendee[];
  autoBook: boolean;
  autoAltTimes: boolean;
  autoAltDates: boolean;
};

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${toLocalDateInput(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultFixedStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalDateTimeInput(d.toISOString());
}

function defaultDraft(): Draft {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  const end = new Date();
  end.setDate(end.getDate() + 7);
  return {
    title: "",
    durationMinutes: 30,
    windowStartDate: toLocalDateInput(start.toISOString()),
    windowEndDate: toLocalDateInput(end.toISOString()),
    timeOfDay: "any",
    notes: "",
    fixedTime: false,
    fixedStart: defaultFixedStart(),
    attendees: [{ email: "", name: "", required: true }],
    autoBook: true,
    autoAltTimes: true,
    autoAltDates: false,
  };
}

const inputCls =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export default function NewRequestWizard({
  onCreated,
  scopesOk = true,
}: {
  onCreated?: () => void;
  scopesOk?: boolean;
}) {
  const [step, setStep] = useState<"describe" | "review">("describe");
  const [direction, setDirection] = useState("");
  const [draft, setDraft] = useState<Draft>(defaultDraft());
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);

  // Users who connected Google before scheduling existed have a token
  // without the send-email and calendar-events permissions. Instead of
  // letting the request fail at Google, stop here and offer the reconnect.
  const ensureScopes = () => {
    if (scopesOk) return true;
    setNeedsReconnect(true);
    return false;
  };

  const reconnectPrompt = needsReconnect ? (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p>
        Scheduling needs permission to send email and create calendar events on
        your behalf. Reconnect Google to grant it, then come back here.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href="/api/auth/google-connect"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Reconnect Google
        </Link>
        <button
          type="button"
          onClick={() => setNeedsReconnect(false)}
          className="text-sm text-muted-foreground hover:underline"
        >
          Not now
        </button>
      </div>
    </div>
  ) : null;

  const parseDirection = async () => {
    if (!direction.trim()) return;
    if (!ensureScopes()) return;
    setWorking(true);
    setError("");
    try {
      const resp = await fetch("/api/scheduling/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(
          err.message || "Couldn't interpret that — you can fill it in below.",
        );
      }
      const { parsed } = await resp.json();
      setDraft({
        title: parsed.title || "",
        durationMinutes: parsed.durationMinutes || 30,
        windowStartDate:
          toLocalDateInput(parsed.windowStartISO) ||
          defaultDraft().windowStartDate,
        windowEndDate:
          toLocalDateInput(parsed.windowEndISO) || defaultDraft().windowEndDate,
        timeOfDay: parsed.timeOfDay || "any",
        notes: parsed.notes || "",
        fixedTime: Boolean(parsed.fixedStartISO),
        fixedStart: parsed.fixedStartISO
          ? toLocalDateTimeInput(parsed.fixedStartISO)
          : defaultFixedStart(),
        attendees: parsed.attendees?.length
          ? parsed.attendees.map((a: any) => ({
              email: a.email || "",
              name: a.name || "",
              required: a.required !== false,
            }))
          : [{ email: "", name: "", required: true }],
        autoBook: true,
        autoAltTimes: true,
        autoAltDates: false,
      });
      setStep("review");
    } catch (e: any) {
      setError(e?.message || "Failed to parse the request");
      // Let the user proceed manually with whatever they typed as the title.
      setDraft((d) => ({ ...d, title: d.title || direction.slice(0, 80) }));
    } finally {
      setWorking(false);
    }
  };

  const updateAttendee = (i: number, patch: Partial<DraftAttendee>) => {
    setDraft((d) => ({
      ...d,
      attendees: d.attendees.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }));
  };

  const submit = async () => {
    if (!ensureScopes()) return;
    setWorking(true);
    setError("");
    try {
      const windowStart = new Date(`${draft.windowStartDate}T00:00:00`);
      // End date is inclusive in the UI; the API window end is exclusive.
      const windowEnd = new Date(`${draft.windowEndDate}T00:00:00`);
      windowEnd.setDate(windowEnd.getDate() + 1);
      const fixedStart = draft.fixedTime ? new Date(draft.fixedStart) : null;
      if (
        draft.fixedTime &&
        (!fixedStart || Number.isNaN(fixedStart.getTime()))
      ) {
        throw new Error("Enter the agreed date and time.");
      }

      const resp = await fetch("/api/scheduling/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          durationMinutes: draft.durationMinutes,
          autoBook: draft.autoBook,
          autoAltTimes: draft.autoAltTimes,
          autoAltDates: draft.autoAltDates,
          constraints: {
            ...(fixedStart && { fixedStartISO: fixedStart.toISOString() }),
            windowStartISO: windowStart.toISOString(),
            windowEndISO: windowEnd.toISOString(),
            timeOfDay: draft.timeOfDay,
            notes: draft.notes,
          },
          attendees: draft.attendees.filter((a) => a.email.trim()),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.message || data.error || "Failed to start");
      }
      setStep("describe");
      setDirection("");
      setDraft(defaultDraft());
      onCreated?.();
    } catch (e: any) {
      setError(e?.message || "Failed to start scheduling");
      onCreated?.(); // a draft may still have been created
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card">
      <h2 className="text-lg font-medium">Schedule a meeting</h2>

      {step === "describe" ? (
        <div className="mt-3 space-y-3">
          <textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            rows={2}
            className={inputCls}
            placeholder='e.g. "Find 30 minutes with Alice and Bob next week in the mornings"'
          />
          {reconnectPrompt}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={parseDirection}
              disabled={working || !direction.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? "Thinking..." : "Draft request"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setStep("review");
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Fill in manually
            </button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Title</label>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className={inputCls}
                placeholder="Design review"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Duration</label>
              <select
                value={draft.durationMinutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    durationMinutes: parseInt(e.target.value, 10),
                  })
                }
                className={inputCls}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>1 hour</option>
                <option value={90}>90 minutes</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.fixedTime}
              onChange={(e) =>
                setDraft({ ...draft, fixedTime: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border border-border text-primary focus:ring-primary"
            />
            <span>
              Time already agreed
              <span className="block text-xs text-muted-foreground">
                Book it directly. Attendees get the calendar invitation and no
                scheduling emails.
              </span>
            </span>
          </label>

          {draft.fixedTime ? (
            <div className="max-w-xs">
              <label className="mb-1 block text-xs font-medium">
                Agreed date and time
              </label>
              <input
                type="datetime-local"
                value={draft.fixedStart}
                onChange={(e) =>
                  setDraft({ ...draft, fixedStart: e.target.value })
                }
                className={inputCls}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Earliest day
                </label>
                <input
                  type="date"
                  value={draft.windowStartDate}
                  onChange={(e) =>
                    setDraft({ ...draft, windowStartDate: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Latest day
                </label>
                <input
                  type="date"
                  value={draft.windowEndDate}
                  onChange={(e) =>
                    setDraft({ ...draft, windowEndDate: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Time of day
                </label>
                <select
                  value={draft.timeOfDay}
                  onChange={(e) =>
                    setDraft({ ...draft, timeOfDay: e.target.value as any })
                  }
                  className={inputCls}
                >
                  <option value="any">Any time</option>
                  <option value="morning">Mornings</option>
                  <option value="afternoon">Afternoons</option>
                  <option value="evening">Evenings</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium">Attendees</label>
            <div className="space-y-2">
              {draft.attendees.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.email}
                    onChange={(e) =>
                      updateAttendee(i, { email: e.target.value })
                    }
                    className={inputCls}
                    placeholder="email@example.com"
                  />
                  <input
                    value={a.name}
                    onChange={(e) =>
                      updateAttendee(i, { name: e.target.value })
                    }
                    className={`${inputCls} max-w-40`}
                    placeholder="Name"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={a.required}
                      onChange={(e) =>
                        updateAttendee(i, { required: e.target.checked })
                      }
                      className="h-3.5 w-3.5 rounded border border-border text-primary focus:ring-primary"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        attendees: d.attendees.filter((_, j) => j !== i),
                      }))
                    }
                    disabled={draft.attendees.length === 1}
                    className="shrink-0 text-xs text-muted-foreground hover:text-destructive disabled:opacity-30"
                    aria-label="Remove attendee"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  attendees: [
                    ...d.attendees,
                    { email: "", name: "", required: true },
                  ],
                }))
              }
              className="mt-2 text-xs font-medium text-primary hover:underline"
            >
              + Add attendee
            </button>
          </div>

          {draft.fixedTime ? null : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.autoBook}
                  onChange={(e) =>
                    setDraft({ ...draft, autoBook: e.target.checked })
                  }
                  className="h-4 w-4 rounded border border-border text-primary focus:ring-primary"
                />
                Book automatically once everyone required agrees
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.autoAltTimes}
                  onChange={(e) =>
                    setDraft({ ...draft, autoAltTimes: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border border-border text-primary focus:ring-primary"
                />
                <span>
                  Let Olly act on alternative times attendees suggest{" "}
                  <span className="text-muted-foreground">
                    within your date window
                  </span>{" "}
                  without checking with you first
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.autoAltDates}
                  onChange={(e) =>
                    setDraft({ ...draft, autoAltDates: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 rounded border border-border text-primary focus:ring-primary"
                />
                <span>
                  Let Olly act on suggested times{" "}
                  <span className="text-muted-foreground">
                    outside your date window
                  </span>{" "}
                  without checking with you first
                </span>
              </label>
            </div>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {reconnectPrompt}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={
                working ||
                !draft.title.trim() ||
                !draft.attendees.some((a) => a.email.trim())
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? "Sending..." : "Start scheduling"}
            </button>
            <button
              type="button"
              onClick={() => setStep("describe")}
              disabled={working}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
