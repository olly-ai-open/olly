import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  approvePendingSlotsCore,
  cancelSchedulingRequestCore,
  confirmSchedulingRequestCore,
  nudgeSchedulingRequestCore,
  pollSchedulingRequestCore,
  rejectPendingSlotsCore,
} from "@olly/core";

type Action =
  | "cancel"
  | "nudge"
  | "book"
  | "poll"
  | "approve"
  | "reject-suggestions";

const ACTIONS: Action[] = [
  "cancel",
  "nudge",
  "book",
  "poll",
  "approve",
  "reject-suggestions",
];

/** Request-level actions: cancel, nudge pending attendees, book, check now. */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const request = await prisma.schedulingRequest.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    switch (action) {
      case "cancel": {
        await cancelSchedulingRequestCore(prisma, id);
        return NextResponse.json({ ok: true });
      }
      case "nudge": {
        const result = await nudgeSchedulingRequestCore(prisma, id);
        return NextResponse.json({ ok: true, ...result });
      }
      case "book": {
        const event = await confirmSchedulingRequestCore(prisma, id);
        return NextResponse.json({ ok: true, event });
      }
      case "poll": {
        const result = await pollSchedulingRequestCore(prisma, id);
        return NextResponse.json({ ok: true, ...result });
      }
      case "approve": {
        const slotStartISOs = Array.isArray(body?.slotStartISOs)
          ? body.slotStartISOs.filter((s: unknown) => typeof s === "string")
          : undefined;
        const result = await approvePendingSlotsCore(prisma, id, slotStartISOs);
        return NextResponse.json({ ok: true, ...result });
      }
      case "reject-suggestions": {
        const result = await rejectPendingSlotsCore(prisma, id);
        return NextResponse.json({ ok: true, ...result });
      }
    }
  } catch (error: any) {
    console.error(`Scheduling action ${action} failed:`, error);
    return NextResponse.json(
      { error: "action_failed", message: error?.message },
      { status: 500 },
    );
  }
}
