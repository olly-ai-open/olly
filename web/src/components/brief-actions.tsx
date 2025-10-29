"use client";
import { useState } from "react";

export default function BriefActions({ briefId, readAt }: { briefId: string; readAt: string | null }) {
  const [isRead, setIsRead] = useState(!!readAt);
  const [sending, setSending] = useState(false);
  const [thumb, setThumb] = useState<"up" | "down" | null>(null);

  async function markRead() {
    try {
      setSending(true);
      await fetch(`/api/briefs/${briefId}/read`, { method: 'POST' });
      setIsRead(true);
    } finally {
      setSending(false);
    }
  }

  async function sendFeedback(v: "up" | "down") {
    setThumb(v);
    try {
      await fetch(`/api/briefs/${briefId}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: v }) });
    } catch {}
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button disabled={isRead || sending} onClick={markRead} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60 cursor-pointer">
        {isRead ? '✓ Read' : '✓ Mark as Read'}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button aria-label="Thumbs up" onClick={() => sendFeedback('up')} className={`rounded-md border px-2 py-1 text-sm ${thumb==='up'?'bg-accent-foreground/30 text-primary border-border':'border-border hover:bg-border/30 cursor-pointer'}`}>👍</button>
        <button aria-label="Thumbs down" onClick={() => sendFeedback('down')} className={`rounded-md border px-2 py-1 text-sm ${thumb==='down'?'bg-accent-foreground/30 text-primary border-border':'border-border hover:bg-border/30 cursor-pointer'}`}>👎</button>
      </div>
    </div>
  );
}
