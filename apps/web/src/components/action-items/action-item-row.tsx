"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

function toDayKeyInTimeZone(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return `${obj.year}-${obj.month}-${obj.day}`;
}

export default function ActionItemRow({
  id,
  title,
  completedAt,
  dueAt,
  timeZone,
  briefId,
}: {
  id: string;
  title: string;
  completedAt: string | null;
  status?: string | null;
  dueAt?: string | null;
  timeZone: string;
  briefId?: string | null;
}) {
  const [completed, setCompleted] = useState(!!completedAt);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editDueDate, setEditDueDate] = useState(
    dueAt ? toDayKeyInTimeZone(new Date(dueAt), timeZone) : "",
  );
  const [editSaving, setEditSaving] = useState(false);
  const router = useRouter();

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

  function startEdit() {
    setEditTitle(title);
    setEditDueDate(dueAt ? toDayKeyInTimeZone(new Date(dueAt), timeZone) : "");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  async function saveEdits() {
    const nextTitle = editTitle.trim();
    if (!nextTitle) {
      alert("Title cannot be empty");
      return;
    }

    setEditSaving(true);
    try {
      const resp = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: nextTitle,
          dueDate: editDueDate.trim() ? editDueDate.trim() : null,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(err.error || "Failed to update action item");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setEditSaving(false);
    }
  }

  async function softDelete() {
    if (
      !confirm(
        "Delete this action item? This will remove it from your lists, but it can still exist for internal tracking.",
      )
    ) {
      return;
    }
    setEditSaving(true);
    try {
      const resp = await fetch(`/api/action-items/${id}`, { method: "DELETE" });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(err.error || "Failed to delete action item");
        return;
      }
      router.refresh();
    } finally {
      setEditSaving(false);
    }
  }

  const dueLabel = dueAt
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone,
      }).format(new Date(dueAt))
    : null;

  return (
    <div
      className={[
        "rounded-lg border border-border bg-card p-4 shadow-sm",
        editing ? "ring-2 ring-primary/20" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {!editing ? (
            <>
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
                {dueLabel ? <>Due: {dueLabel}</> : <>No due date</>}
                <button
                  type="button"
                  onClick={startEdit}
                  className="ml-2 underline cursor-pointer"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={softDelete}
                  disabled={editSaving}
                  className="ml-2 underline cursor-pointer disabled:opacity-60"
                >
                  Delete
                </button>
                {briefId ? (
                  <>
                    {" • "}
                    <Link className="underline" href={`/briefs/${briefId}`}>
                      View Context
                    </Link>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex w-full items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <textarea
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Action item title"
                    aria-label="Action item title"
                    rows={3}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium leading-5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-muted-foreground">Due</span>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setEditDueDate("")}
                  className="text-muted-foreground underline cursor-pointer"
                >
                  Clear
                </button>

                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveEdits}
                    disabled={editSaving || saving}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {editSaving ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={editSaving}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-border/20 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={softDelete}
                    disabled={editSaving}
                    className="rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
