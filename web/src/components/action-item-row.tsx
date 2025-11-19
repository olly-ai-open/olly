"use client";
import { useState } from "react";
import ActionItemAssignees from "@/components/action-item-assignees";
import Link from "next/link";

type Person = { id: string; name?: string | null; email?: string | null };

export default function ActionItemRow({
  id,
  title,
  completedAt,
  dueAt,
  briefId,
  assigned,
  options,
}: {
  id: string;
  title: string;
  completedAt: string | null;
  status?: string | null;
  dueAt?: string | null;
  briefId?: string | null;
  assigned: Person[];
  options: Person[];
}) {
  const [completed, setCompleted] = useState(!!completedAt);
  const [saving, setSaving] = useState(false);

  async function toggleComplete(next: boolean) {
    setSaving(true);
    try {
      await fetch(`/api/action-items/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completed: next }),
      });
      setCompleted(next);
    } finally {
      setSaving(false);
    }
  }

  const dueLabel = dueAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
        new Date(dueAt),
      )
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={completed}
                onChange={(e) => toggleComplete(e.target.checked)}
                disabled={saving}
              />
              <span
                className={
                  completed ? "line-through text-muted-foreground" : ""
                }
              >
                {title}
              </span>
            </label>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {dueLabel ? <>Due: {dueLabel}</> : null}
            {briefId ? (
              <>
                {dueLabel ? " • " : ""}
                <Link className="underline" href={`/briefs/${briefId}`}>
                  View Context
                </Link>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {/* <ActionItemAssignees
        actionItemId={id}
        assigned={assigned}
        options={options}
      /> */}
    </div>
  );
}
