import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  context: RouteContext<"/api/people/[id]">,
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const person = await prisma.person.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!person) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const { name, title, org } = body ?? {};
  const data: Record<string, string | null> = {};

  const normalizeString = (value: unknown) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const nextName = normalizeString(name);
  const nextTitle = normalizeString(title);
  const nextOrg = normalizeString(org);

  if (nextName !== undefined) data.name = nextName;
  if (nextTitle !== undefined) data.title = nextTitle;
  if (nextOrg !== undefined) data.org = nextOrg;

  if (!Object.keys(data).length) {
    return NextResponse.json(
      { ok: false, error: "no_fields_to_update" },
      { status: 400 },
    );
  }

  const updated = await prisma.person.update({
    where: { id: person.id },
    data,
  });

  return NextResponse.json({ ok: true, person: updated });
}
