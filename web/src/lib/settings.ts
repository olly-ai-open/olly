import { prisma } from "@/lib/prisma";

export interface UserSettings {
  id: string;
  userId: string;
  searchTimeframeDays: number;
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
