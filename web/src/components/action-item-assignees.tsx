"use client";
import { useState } from "react";

type Person = { id: string; name?: string | null; email?: string | null };

export default function ActionItemAssignees({
  actionItemId,
  assigned,
  options,
}: {
  actionItemId: string;
  assigned: Person[];
  options: Person[];
}) {
  const [assignees, setAssignees] = useState<Person[]>(assigned);
  const [adding, setAdding] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const remaining = options.filter((p) => !assignees.some((a) => a.id === p.id));

  async function add(personId: string) {
    if (!personId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/action-items/${actionItemId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      if (res.ok) {
        const person = options.find((p) => p.id === personId);
        if (person) setAssignees((s) => [...s, person]);
        setAdding("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(personId: string) {
    setBusy(true);
    try {
      await fetch(`/api/action-items/${actionItemId}/unassign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId }),
      });
      setAssignees((s) => s.filter((a) => a.id !== personId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {assignees.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-xs text-primary">
            <span>{a.name || a.email || "Unknown"}</span>
            <button onClick={() => remove(a.id)} className="ml-1 text-xs" title="Remove" disabled={busy}>×</button>
          </span>
        ))}
        {!assignees.length && <span className="text-xs text-muted-foreground">No assignees</span>}
      </div>
      {remaining.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-card px-2 py-1 text-sm"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            disabled={busy}
          >
            <option value="">Assign person…</option>
            {remaining.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.email}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-sm hover:bg-border/30"
            onClick={() => add(adding)}
            disabled={!adding || busy}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

