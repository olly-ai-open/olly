import type { PrismaClient } from "@prisma/client";
import { getAccessTokenFromAccountCore } from "./google-core";
import { sendGmailMessageWithToken } from "../google-http";

export type BriefEmailKind = "MORNING_BRIEF" | "EVENING_BRIEF" | "MEETING_BRIEF";

/**
 * Email a finished brief to the user, from the user's own Gmail account.
 *
 * Sending from the user's own account means there is no system mailbox to
 * run, and it works the same on the desktop app, a self-hosted server, and
 * any other deployment. It requires the gmail.send scope, which the
 * Google connect flow requests; users who connected before that scope
 * existed are skipped until they reconnect.
 *
 * Gated by the user's "email notifications" setting. Never throws: brief
 * generation must not fail because an email could not be sent.
 */
export async function sendBriefEmail(
  prisma: PrismaClient,
  opts: { userId: string; briefId: string; kind: BriefEmailKind },
): Promise<{ ok: boolean; skipped?: string }> {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: opts.userId },
      select: { emailNotifications: true, timeZone: true },
    });
    if (!settings?.emailNotifications) return { ok: false, skipped: "disabled" };

    const account = await prisma.account.findFirst({
      where: { userId: opts.userId, provider: "google" },
    });
    if (!account) return { ok: false, skipped: "no_google_account" };
    if (!(account.scope || "").includes("auth/gmail.send")) {
      return { ok: false, skipped: "missing_gmail_send_scope" };
    }

    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: { email: true },
    });
    const to = user?.email || account.providerAccountId || null;
    if (!to || !to.includes("@")) return { ok: false, skipped: "no_email_address" };

    const brief = await prisma.brief.findUnique({
      where: { id: opts.briefId },
      include: { meeting: { select: { title: true, startsAt: true } } },
    });
    if (!brief) return { ok: false, skipped: "brief_not_found" };

    const markdown = extractMarkdown(brief.content);
    if (!markdown.trim()) return { ok: false, skipped: "empty_brief" };

    const timeZone = settings.timeZone || "UTC";
    const subject = subjectFor(opts.kind, brief.meeting, timeZone);
    const link = briefLink(opts.briefId);
    const bodyText =
      `${markdownToPlainText(markdown)}\n\n` +
      (link ? `Open in Olly: ${link}\n\n` : "") +
      "You are receiving this because email notifications are on in your Olly settings.";

    const token = await getAccessTokenFromAccountCore(prisma, account as any);
    await sendGmailMessageWithToken(token, { to: [to], subject, bodyText });
    return { ok: true };
  } catch (err) {
    console.error(`[briefEmail] failed to send ${opts.kind} for brief ${opts.briefId}:`, err);
    return { ok: false, skipped: "send_failed" };
  }
}

function extractMarkdown(content: unknown): string {
  let obj: any = content;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return obj;
    }
  }
  return typeof obj?.brief_markdown === "string" ? obj.brief_markdown : "";
}

function subjectFor(
  kind: BriefEmailKind,
  meeting: { title: string; startsAt: Date } | null,
  timeZone: string,
): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  switch (kind) {
    case "MORNING_BRIEF":
      return `Morning brief for ${day.format(new Date())}`;
    case "EVENING_BRIEF":
      return `End of day summary for ${day.format(new Date())}`;
    case "MEETING_BRIEF": {
      const title = meeting?.title || "your meeting";
      const when = meeting?.startsAt ? ` at ${time.format(meeting.startsAt)}` : "";
      return `Meeting brief: ${title}${when}`;
    }
  }
}

function briefLink(briefId: string): string | null {
  const base = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  return base ? `${base}/briefs/${briefId}` : null;
}

/** Strip the Markdown syntax that reads badly in a plain-text email. */
function markdownToPlainText(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-*•]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
