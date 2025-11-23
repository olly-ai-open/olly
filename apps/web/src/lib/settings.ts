import { prisma } from "@/lib/prisma";
import {
  getUserSearchStrategyCore,
  getUserSearchTimeframeCore,
  getUserSettingsCore,
  type SearchStrategySetting,
  type UserSettings,
} from "@olly/core";

export type { UserSettings, SearchStrategySetting };

export async function getUserSettings(userId: string): Promise<UserSettings> {
  return getUserSettingsCore(prisma, userId);
}

export async function getUserSearchTimeframe(userId: string): Promise<number> {
  return getUserSearchTimeframeCore(prisma, userId);
}

export async function getUserSearchStrategy(
  userId: string,
): Promise<SearchStrategySetting | null> {
  return getUserSearchStrategyCore(prisma, userId);
}
