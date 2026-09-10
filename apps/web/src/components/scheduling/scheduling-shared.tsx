export type SchedulingAttendee = {
  id: string;
  email: string;
  name: string | null;
  required: boolean;
  responseStatus: string;
};

export type PendingSlot = {
  startISO: string;
  endISO: string;
  suggestedBy: string;
  calendarStatus?: "free" | "busy" | "unknown";
  conflictTitle?: string | null;
};

export type SchedulingRequestSummary = {
  id: string;
  title: string;
  durationMinutes: number;
  status: string;
  round: number;
  autoBook: boolean;
  attentionReason: string | null;
  pendingSlots: PendingSlot[] | null;
  bookedSlot: { startISO: string; endISO: string } | null;
  createdAt: string;
  updatedAt: string;
  attendees: SchedulingAttendee[];
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  AWAITING_REPLIES: "Awaiting replies",
  NEGOTIATING: "Negotiating",
  AWAITING_APPROVAL: "Needs your approval",
  READY_TO_BOOK: "Ready to book",
  BOOKED: "Booked",
  NEEDS_ATTENTION: "Needs attention",
  CANCELLED: "Cancelled",
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  AWAITING_REPLIES: "bg-primary/10 text-primary",
  NEGOTIATING: "bg-primary/10 text-primary",
  AWAITING_APPROVAL: "bg-warning/15 text-warning",
  READY_TO_BOOK: "bg-success/15 text-success",
  BOOKED: "bg-success/15 text-success",
  NEEDS_ATTENTION: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] || "bg-muted text-muted-foreground"
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

/** "Tue, Aug 18, 9:00 – 9:30 AM" in the browser's zone. */
export function formatSlot(slot: { startISO: string; endISO: string }) {
  const start = new Date(slot.startISO);
  const end = new Date(slot.endISO);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${time.format(start)} – ${time.format(end)}`;
}
