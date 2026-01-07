import type {
  PrismaClient,
  UserSettings as PrismaUserSettings,
} from "@prisma/client";

export type UserSettings = PrismaUserSettings;

export async function getUserSettingsCore(
  prisma: PrismaClient,
  userId: string,
): Promise<UserSettings> {
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
        emailNotifications: true,
        webNotificationsEnabled: false,
        ignoredEventPatterns: [],
      },
    });
  }

  return settings;
}

export async function getUserSearchTimeframeCore(
  prisma: PrismaClient,
  userId: string,
): Promise<number> {
  const settings = await getUserSettingsCore(prisma, userId);
  return settings.searchTimeframeDays;
}
