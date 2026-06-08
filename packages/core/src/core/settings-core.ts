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
    timeZone: settings.timeZone ?? null,
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