import { prisma } from "@/lib/prisma";

export type UserSettings = {
  searchTimeframeDays: number;
  briefSystemPrompt: string | null;
  queryPlannerSystemPrompt: string | null;
  morningBriefSystemPrompt: string | null;
  endOfDayBriefSystemPrompt: string | null;
  timeZone: string | null;
  telemetryOptIn: boolean;
  emailNotifications: boolean;
  webNotificationsEnabled: boolean;
  ignoredEventPatterns: unknown[];
};

// When the user hasn't picked a timezone, fall back to the host machine's
// zone. On the desktop app the server runs on the user's machine, so this is
// their local zone; on cloud hosts it resolves to UTC, matching the old
// behavior of `settings.timeZone || "UTC"` consumers.
export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function ensureUserExists(userId: string) {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });
}

export async function getUserSettingsCore(userId: string): Promise<UserSettings> {
  await ensureUserExists(userId);

  let settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  if (!settings) {
    settings = await prisma.userSettings.create({
      data: {
        userId,
        searchTimeframeDays: 30,
        briefSystemPrompt: null,
        queryPlannerSystemPrompt: null,
        morningBriefSystemPrompt: null,
        endOfDayBriefSystemPrompt: null,
        timeZone: null,
        telemetryOptIn: true,
        emailNotifications: true,
        webNotificationsEnabled: false,
        ignoredEventPatterns: [],
      },
    });
  }

  return {
    searchTimeframeDays: settings.searchTimeframeDays ?? 30,
    briefSystemPrompt: settings.briefSystemPrompt ?? null,
    queryPlannerSystemPrompt: settings.queryPlannerSystemPrompt ?? null,
    morningBriefSystemPrompt: settings.morningBriefSystemPrompt ?? null,
    endOfDayBriefSystemPrompt: settings.endOfDayBriefSystemPrompt ?? null,
    timeZone: settings.timeZone ?? defaultTimeZone(),
    telemetryOptIn: settings.telemetryOptIn ?? true,
    emailNotifications: settings.emailNotifications ?? true,
    webNotificationsEnabled: settings.webNotificationsEnabled ?? false,
    ignoredEventPatterns: Array.isArray(settings.ignoredEventPatterns)
      ? settings.ignoredEventPatterns
      : [],
  };
}

export async function getUserSearchTimeframeCore(
  userId: string,
): Promise<number> {
  const settings = await getUserSettingsCore(userId);
  return settings.searchTimeframeDays ?? 30;
}