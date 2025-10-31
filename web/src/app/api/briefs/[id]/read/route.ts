import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  context: RouteContext<"/api/briefs/[id]/read">,
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  const brief = await prisma.brief.findUnique({
    where: { id },
    include: { meeting: true },
  });
  if (!brief || brief.meeting?.userId !== session.user.id)
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  await prisma.brief.update({
    where: { id },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
