import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";

export type BriefNotificationKind =
  | "MORNING_BRIEF"
  | "EVENING_BRIEF"
  | "MEETING_BRIEF";

let warnedMissingSubject = false;

/**
 * Web push is only configured when the operator supplies a VAPID keypair and a
 * contact subject (a mailto: address or https: URL identifying who runs this
 * deployment). Push services use the subject to reach the operator, so there
 * is deliberately no default.
 */
function ensureVapidConfigured(): boolean {
  const vapidPublicKey =
    process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT?.trim();
  if (!vapidPublicKey || !vapidPrivateKey) {
    return false;
  }
  if (!vapidSubject) {
    if (!warnedMissingSubject) {
      warnedMissingSubject = true;
      console.warn(
        "[webPush] VAPID keys are set but VAPID_SUBJECT is missing; push notifications are disabled.",
      );
    }
    return false;
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  return true;
}

function copyForKind(kind: BriefNotificationKind) {
  if (kind === "MORNING_BRIEF") {
    return {
      title: "Morning brief is ready",
      body: "Your morning summary is ready to review.",
      tag: "olly-morning-brief",
    };
  }
  if (kind === "EVENING_BRIEF") {
    return {
      title: "End-of-day summary is ready",
      body: "Your end-of-day summary is ready.",
      tag: "olly-evening-brief",
    };
  }
  return {
    title: "Meeting brief is ready",
    body: "Your meeting brief is ready.",
    tag: "olly-meeting-brief",
  };
}

export async function sendBriefReadyWebPush(
  prisma: PrismaClient,
  opts: {
    userId: string;
    briefId: string;
    kind: BriefNotificationKind;
  },
): Promise<{ ok: boolean; sent?: number; skipped?: string }> {
  if (!ensureVapidConfigured()) {
    return { ok: false, skipped: "vapid_not_configured" };
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: opts.userId },
    select: { webNotificationsEnabled: true },
  });

  if (!settings?.webNotificationsEnabled) {
    return { ok: false, skipped: "disabled" };
  }

  const subscriptions = await prisma.webPushSubscription.findMany({
    where: { userId: opts.userId },
  });

  if (subscriptions.length === 0) {
    return { ok: false, skipped: "no_subscriptions" };
  }

  const copy = copyForKind(opts.kind);
  const payload = JSON.stringify({
    title: copy.title,
    body: copy.body,
    tag: copy.tag,
    url: `/briefs/${opts.briefId}`,
  });

  const staleEndpoints: string[] = [];

  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
        return true;
      } catch (err: any) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(sub.endpoint);
        }
        return false;
      }
    }),
  );

  const sent = results.filter(Boolean).length;

  if (staleEndpoints.length) {
    await prisma.webPushSubscription.deleteMany({
      where: { endpoint: { in: staleEndpoints } },
    });
  }

  return { ok: true, sent };
}
