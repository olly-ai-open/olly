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
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  workingDays: number[];
  meetingBufferMinutes: number;
  minSchedulingNoticeHours: number;
  meetingBriefLeadMinutes: number;
  calendarSyncIntervalMinutes: number;
  llmProvider: string | null;
  llmModel: string | null;
};

export const DEFAULT_MEETING_BRIEF_LEAD_MINUTES = 5;
export const DEFAULT_CALENDAR_SYNC_INTERVAL_MINUTES = 60;

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon-Fri (ISO weekday)

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
    workingHoursStart: settings.workingHoursStart ?? null,
    workingHoursEnd: settings.workingHoursEnd ?? null,
    workingDays: Array.isArray(settings.workingDays)
      ? (settings.workingDays as number[])
      : DEFAULT_WORKING_DAYS,
    meetingBufferMinutes: settings.meetingBufferMinutes ?? 0,
    minSchedulingNoticeHours: settings.minSchedulingNoticeHours ?? 24,
    meetingBriefLeadMinutes:
      settings.meetingBriefLeadMinutes ?? DEFAULT_MEETING_BRIEF_LEAD_MINUTES,
    calendarSyncIntervalMinutes:
      settings.calendarSyncIntervalMinutes ??
      DEFAULT_CALENDAR_SYNC_INTERVAL_MINUTES,
    llmProvider: settings.llmProvider ?? null,
    llmModel: settings.llmModel ?? null,
  };
}

export async function getUserSearchTimeframeCore(
  userId: string,
): Promise<number> {
  const settings = await getUserSettingsCore(userId);
  return settings.searchTimeframeDays ?? 30;
}