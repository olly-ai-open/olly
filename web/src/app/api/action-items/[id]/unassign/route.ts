import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  const body = await req.json().catch(() => ({}));
  const personId = body?.personId as string | undefined;
  if (!personId)
    return NextResponse.json(
      { ok: false, error: "missing_personId" },
      { status: 400 },
    );

  // Verify ownership
  const ai = await prisma.actionItem.findUnique({ where: { id: params.id } });
  if (!ai || ai.userId !== session.user.id)
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );

  await prisma.actionItemAssignee.deleteMany({
    where: { actionItemId: params.id, personId },
  });
  return NextResponse.json({ ok: true });
}
