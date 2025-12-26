import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const subscription = body?.subscription;
  const endpoint =
    typeof subscription?.endpoint === "string" ? subscription.endpoint : null;
  const p256dh =
    typeof subscription?.keys?.p256dh === "string"
      ? subscription.keys.p256dh
      : null;
  const authKey =
    typeof subscription?.keys?.auth === "string"
      ? subscription.keys.auth
      : null;

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json(
      { error: "invalid_subscription" },
      { status: 400 },
    );
  }

  const userAgent = req.headers.get("user-agent");

  const saved = await prisma.webPushSubscription.upsert({
    where: { endpoint },
    update: {
      userId: session.user.id,
      p256dh,
      auth: authKey,
      userAgent,
    },
    create: {
      userId: session.user.id,
      endpoint,
      p256dh,
      auth: authKey,
      userAgent,
    },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const endpoint =
    typeof body?.endpoint === "string" ? body.endpoint : undefined;

  if (endpoint) {
    await prisma.webPushSubscription.deleteMany({
      where: { userId: session.user.id, endpoint },
    });
  } else {
    await prisma.webPushSubscription.deleteMany({
      where: { userId: session.user.id },
    });
  }

  return NextResponse.json({ ok: true });
}
