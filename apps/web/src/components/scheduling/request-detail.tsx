"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  StatusBadge,
  formatSlot,
  type PendingSlot,
  type SchedulingAttendee,
} from "./scheduling-shared";

type Message = {
  id: string;
  direction: string;
  fromEmail: string | null;
  snippet: string | null;
  round: number | null;
  createdAt: string;
  parsedIntent: { summary?: string; intent?: string } | null;
};

type RequestDetailData = {
  id: string;
  title: string;
  durationMinutes: number;
  status: string;
  round: number;
  autoBook: boolean;
  attentionReason: string | null;
  proposedSlots: Array<{ startISO: string; endISO: string }> | null;
  pendingSlots: PendingSlot[] | null;
  bookedSlot: { startISO: string; endISO: string } | null;
  constraints: { notes?: string; timeOfDay?: string } | null;
  attendees: SchedulingAttendee[];
  messages: Message[];
  createdAt: string;
};

const RESPONSE_LABELS: Record<string, string> = {
  PENDING: "No reply yet",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  COUNTERED: "Proposed alternatives",
};

export default function RequestDetail({ requestId }: { requestId: string }) {
  const [request, setRequest] = useState<RequestDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const resp = await fetch(`/api/scheduling/requests/${requestId}`);
      if (!resp.ok) throw new Error("not_found");
      const data = await resp.json();
      setRequest(data.request);
    } catch {
      setError("Failed to load this scheduling request");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (
    action:
      | "cancel"
      | "nudge"
      | "book"
      | "poll"
      | "approve"
      | "reject-suggestions",
  ) => {
    if (
      action === "cancel" &&
      !window.confirm("Cancel this scheduling request?")
    ) {
      return;
    }
    setWorking(action);
    setError("");
    try {
      const resp = await fetch(
        `/api/scheduling/requests/${requestId}/actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.message || data.error || "Action failed");
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Action failed");
    } finally {
      setWorking(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (!request) {
    return (
      <div>
        <p className="text-sm text-destructive">
          {error || "Scheduling request not found."}
        </p>
        <Link
          href="/scheduling"
          className="mt-2 inline-block text-sm text-primary hover:underline"
        >
          Back to scheduling
        </Link>
      </div>
    );
  }

  const active = ["AWAITING_REPLIES", "NEGOTIATING"].includes(request.status);
  const proposedSlots = request.proposedSlots || [];
  const pendingSlots = request.pendingSlots || [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/scheduling"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← All requests
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{request.title}</h1>
          <StatusBadge status={request.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {request.durationMinutes} minutes · round {request.round}
          {request.autoBook ? " · books automatically" : " · asks before booking"}
        </p>
        {request.status === "NEEDS_ATTENTION" && request.attentionReason ? (
          <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {request.attentionReason}
          </p>
        ) : null}
        {request.status === "BOOKED" && request.bookedSlot ? (
          <p className="mt-2 rounded-md border border-border bg-success/10 px-3 py-2 text-sm">
            Booked for {formatSlot(request.bookedSlot)} — calendar invites
            sent.
          </p>
        ) : null}
      </div>

      {request.status === "AWAITING_APPROVAL" && pendingSlots.length ? (
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4 shadow-card">
          <h2 className="text-sm font-semibold">Needs your approval</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An attendee suggested time(s) that need your sign-off before Olly
            confirms with everyone:
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {pendingSlots.map((s) => (
              <li key={s.startISO}>
                <div>
                  <span className="font-medium">{formatSlot(s)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    suggested by {s.suggestedBy}
                  </span>
                </div>
                <div
                  className={
                    s.calendarStatus === "busy"
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {s.calendarStatus === "busy"
                    ? s.conflictTitle
                      ? `Busy on your calendar — conflicts with “${s.conflictTitle}”`
                      : "Busy on your calendar — conflicts with an existing meeting"
                    : s.calendarStatus === "free"
                      ? "Free on your calendar"
                      : "Calendar status unknown"}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => runAction("approve")}
              disabled={!!working}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {working === "approve"
                ? "Sending..."
                : "Approve — confirm with attendees"}
            </button>
            <button
              type="button"
              onClick={() => runAction("reject-suggestions")}
              disabled={!!working}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-border/40 disabled:opacity-50"
            >
              {working === "reject-suggestions"
                ? "Sending..."
                : "Decline — ask for other times"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <>
            <button
              type="button"
              onClick={() => runAction("poll")}
              disabled={!!working}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-border/40 disabled:opacity-50"
            >
              {working === "poll" ? "Checking..." : "Check for replies now"}
            </button>
            <button
              type="button"
              onClick={() => runAction("nudge")}
              disabled={!!working}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-border/40 disabled:opacity-50"
            >
              {working === "nudge" ? "Nudging..." : "Nudge non-responders"}
            </button>
          </>
        ) : null}
        {request.status === "READY_TO_BOOK" ? (
          <button
            type="button"
            onClick={() => runAction("book")}
            disabled={!!working}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {working === "book"
              ? "Booking..."
              : `Book ${request.bookedSlot ? formatSlot(request.bookedSlot) : "now"}`}
          </button>
        ) : null}
        {!["BOOKED", "CANCELLED"].includes(request.status) ? (
          <button
            type="button"
            onClick={() => runAction("cancel")}
            disabled={!!working}
            className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {working === "cancel" ? "Cancelling..." : "Cancel request"}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card">
          <h2 className="text-sm font-semibold">Attendees</h2>
          <ul className="mt-2 space-y-2">
            {request.attendees.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <span className="truncate">{a.name || a.email}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {a.required ? "required" : "optional"}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {RESPONSE_LABELS[a.responseStatus] || a.responseStatus}
                </span>
              </li>
            ))}
          </ul>

          {proposedSlots.length ? (
            <>
              <h2 className="mt-4 text-sm font-semibold">Proposed times</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {proposedSlots.map((s) => (
                  <li key={s.startISO}>{formatSlot(s)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card">
          <h2 className="text-sm font-semibold">Timeline</h2>
          {request.messages.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No messages yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-3">
              {request.messages.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={
                        m.direction === "outbound"
                          ? "font-medium text-primary"
                          : "font-medium text-foreground"
                      }
                    >
                      {m.direction === "outbound"
                        ? "Olly"
                        : m.fromEmail || "Reply"}
                    </span>
                    <span>
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(m.createdAt))}
                    </span>
                    {typeof m.round === "number" ? (
                      <span>· round {m.round}</span>
                    ) : null}
                  </div>
                  {m.parsedIntent?.summary ? (
                    <div className="mt-0.5 text-xs italic text-muted-foreground">
                      {m.parsedIntent.summary}
                    </div>
                  ) : null}
                  <div className="mt-0.5 whitespace-pre-line text-sm text-foreground/90">
                    {m.snippet || ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
