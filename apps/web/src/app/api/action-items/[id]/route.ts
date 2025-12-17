import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSettings } from "@/lib/settings";

function getUtcStartOfLocalDay(dayISO: string, timeZone: string): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const partsToObj = (d: Date) => {
    const parts = formatter.formatToParts(d);
    const obj: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") obj[p.type] = p.value;
    }
    return obj;
  };

  const [yearStr, monthStr, dayStr] = dayISO.split("-");
  const targetLocalMs = Date.UTC(
    Number(yearStr),
    Number(monthStr) - 1,
    Number(dayStr),
    0,
    0,
    0,
  );

  const guessUtc = new Date(`${dayISO}T00:00:00Z`);
  const currentParts = partsToObj(guessUtc);
  const currentLocalMs = Date.UTC(
    Number(currentParts.year),
    Number(currentParts.month) - 1,
    Number(currentParts.day),
    Number(currentParts.hour),
    Number(currentParts.minute),
    Number(currentParts.second),
  );

  const diffMs = targetLocalMs - currentLocalMs;
  return new Date(guessUtc.getTime() + diffMs);
}

type PatchBody = {
  title?: string;
  dueDate?: string | null;
};

export async function PATCH(
  req: NextRequest,
  context: RouteContext<"/api/action-items/[id]">,
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const ai = await prisma.actionItem.findUnique({ where: { id } });
  if (!ai || ai.userId !== session.user.id || ai.status === "deleted") {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  const next: { title?: string; dueAt?: Date | null } = {};
  let changed = false;

  if (body.title !== undefined) {
    if (typeof body.title !== "string") {
      return NextResponse.json(
        { ok: false, error: "title must be a string" },
        { status: 400 },
      );
    }
    const trimmed = body.title.trim();
    if (!trimmed) {
      return NextResponse.json(
        { ok: false, error: "title cannot be empty" },
        { status: 400 },
      );
    }
    if (trimmed !== ai.title) {
      next.title = trimmed;
      changed = true;
    }
  }

  if (body.dueDate !== undefined) {
    const settings = await getUserSettings(session.user.id);
    const timeZone = settings.timeZone || "UTC";

    if (body.dueDate === null) {
      const current = ai.dueAt ? ai.dueAt.toISOString() : null;
      if (current !== null) {
        next.dueAt = null;
        changed = true;
      }
    } else if (typeof body.dueDate !== "string") {
      return NextResponse.json(
        { ok: false, error: "dueDate must be YYYY-MM-DD or null" },
        { status: 400 },
      );
    } else {
      const dueDate = body.dueDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        return NextResponse.json(
          { ok: false, error: "dueDate must be YYYY-MM-DD or null" },
          { status: 400 },
        );
      }
      const dueAt = getUtcStartOfLocalDay(dueDate, timeZone);
      if (Number.isNaN(dueAt.getTime())) {
        return NextResponse.json(
          { ok: false, error: "invalid_dueDate" },
          { status: 400 },
        );
      }
      const current = ai.dueAt ? ai.dueAt.toISOString() : null;
      if (current !== dueAt.toISOString()) {
        next.dueAt = dueAt;
        changed = true;
      }
    }
  }

  if (!changed) {
    return NextResponse.json({ ok: true, item: ai });
  }

  const updated = await prisma.actionItem.update({
    where: { id },
    data: next,
  });

  try {
    await (prisma as any).actionItemEvent.create({
      data: {
        userId: session.user.id,
        actionItemId: id,
        type: "EDIT",
      },
    });
  } catch {
    // best-effort only
  }

  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(
  _req: NextRequest,
  context: RouteContext<"/api/action-items/[id]">,
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const ai = await prisma.actionItem.findUnique({ where: { id } });
  if (!ai || ai.userId !== session.user.id || ai.status === "deleted") {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  await prisma.actionItem.update({
    where: { id },
    data: { status: "deleted" },
  });

  try {
    await (prisma as any).actionItemEvent.create({
      data: {
        userId: session.user.id,
        actionItemId: id,
        type: "DELETE",
      },
    });
  } catch {
    // best-effort only
  }

  return NextResponse.json({ ok: true });
}
