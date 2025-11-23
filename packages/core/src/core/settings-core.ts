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
        searchStrategy: null,
        briefSystemPrompt: null,
        queryPlannerSystemPrompt: null,
        morningBriefSystemPrompt: null,
        timeZone: null,
        emailNotifications: true,
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

export type SearchStrategySetting =
  | "LLM_ONLY"
  | "HEURISTIC_ONLY"
  | "LLM_AND_HEURISTIC";

export async function getUserSearchStrategyCore(
  prisma: PrismaClient,
  userId: string,
): Promise<SearchStrategySetting | null> {
  const settings = await getUserSettingsCore(prisma, userId);
  const value = settings.searchStrategy;
  if (
    value === "LLM_ONLY" ||
    value === "HEURISTIC_ONLY" ||
    value === "LLM_AND_HEURISTIC"
  ) {
    return value;
  }
  return null;
}
