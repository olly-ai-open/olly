"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import NewRequestWizard from "./new-request-wizard";
import {
  StatusBadge,
  formatSlot,
  type SchedulingRequestSummary,
} from "./scheduling-shared";

export default function SchedulingDashboard({
  scopesOk = true,
}: {
  /** False when the user's Google connection lacks the send-email and
   *  calendar-events permissions scheduling needs. */
  scopesOk?: boolean;
}) {
  const [requests, setRequests] = useState<SchedulingRequestSummary[] | null>(
    null,
  );
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const resp = await fetch("/api/scheduling/requests");
      if (!resp.ok) throw new Error("failed_to_load");
      const data = await resp.json();
      setRequests(data.requests || []);
    } catch {
      setError("Failed to load scheduling requests");
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <NewRequestWizard onCreated={load} scopesOk={scopesOk} />

      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-card">
        <h2 className="text-lg font-medium">Requests</h2>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        {requests === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
        ) : requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No scheduling requests yet. Describe one above to get started.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {requests.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/scheduling/${r.id}`}
                  className="flex items-center justify-between gap-4 py-3 hover:bg-border/20"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {r.title}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {r.durationMinutes} min ·{" "}
                      {r.attendees.map((a) => a.name || a.email).join(", ")}
                      {r.status === "BOOKED" && r.bookedSlot
                        ? ` · ${formatSlot(r.bookedSlot)}`
                        : null}
                      {r.status === "NEEDS_ATTENTION" && r.attentionReason
                        ? ` · ${r.attentionReason}`
                        : null}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
