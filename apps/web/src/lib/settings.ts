import { prisma } from "@/lib/prisma";
import {
  getUserSearchTimeframeCore,
  getUserSettingsCore,
  type UserSettings,
} from "@olly/core";

export type { UserSettings };

export async function getUserSettings(userId: string): Promise<UserSettings> {
  return getUserSettingsCore(prisma, userId);
}

export async function getUserSearchTimeframe(userId: string): Promise<number> {
  return getUserSearchTimeframeCore(prisma, userId);
}
