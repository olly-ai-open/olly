import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  const brief = await prisma.brief.findUnique({
    where: { id: params.id },
    include: { meeting: true },
  });
  if (!brief || brief.meeting?.userId !== session.user.id)
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  await prisma.brief.update({
    where: { id: params.id },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
