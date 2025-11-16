import { prisma } from "@/lib/prisma";

export interface UserSettings {
  id: string;
  userId: string;
  searchTimeframeDays: number;
  searchStrategy?: string | null;
  emailNotifications: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get user settings, creating defaults if none exist
 */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  let settings = await prisma.userSettings.findUnique({
    where: { userId },
  });

  if (!settings) {
    settings = await prisma.userSettings.create({
      data: {
        userId,
        searchTimeframeDays: 30,
        searchStrategy: null,
        emailNotifications: true,
      },
    });
  }

  return settings;
}

/**
 * Get the search timeframe for a user in days
 */
export async function getUserSearchTimeframe(userId: string): Promise<number> {
  const settings = await getUserSettings(userId);
  return settings.searchTimeframeDays;
}

export type SearchStrategySetting =
  | "LLM_ONLY"
  | "HEURISTIC_ONLY"
  | "LLM_AND_HEURISTIC";

export async function getUserSearchStrategy(
  userId: string,
): Promise<SearchStrategySetting | null> {
  const settings = await getUserSettings(userId);
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
