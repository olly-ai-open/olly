import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  context: RouteContext<"/api/action-items/[id]/complete">,
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  const body = await req.json().catch(() => ({}));
  const completed = Boolean(body?.completed);
  const ai = await prisma.actionItem.findUnique({ where: { id } });
  if (!ai || ai.userId !== session.user.id || ai.status === "deleted")
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  const updated = await prisma.actionItem.update({
    where: { id },
    data: {
      completedAt: completed ? new Date() : null,
      status: completed ? "done" : "open",
    },
  });
  return NextResponse.json({ ok: true, item: updated });
}
