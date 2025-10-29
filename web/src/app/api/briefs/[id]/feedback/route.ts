import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const value = body?.value as 'up' | 'down' | undefined;
  if (!value) return NextResponse.json({ ok: false, error: "missing_value" }, { status: 400 });
  const brief = await prisma.brief.findUnique({ where: { id: params.id }, include: { meeting: true } });
  if (!brief || brief.meeting?.userId !== session.user.id) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const feedback = { ...(brief.feedback as any), thumb: value, at: new Date().toISOString() };
  await prisma.brief.update({ where: { id: params.id }, data: { feedback } });
  return NextResponse.json({ ok: true });
}

