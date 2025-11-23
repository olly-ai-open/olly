export interface ScheduleConfig {
  timeZone: string;
  timeOfDay: string; // "HH:MM"
  daysOfWeek?: number[]; // 0-6, where 0=Sunday
}

/**
 * Compute the next run time in UTC for a given schedule configuration.
 * This is a best-effort implementation using Intl APIs and assumes the
 * timezone offset is stable over the next few days (DST transitions may
 * introduce small discrepancies near boundaries).
 */
export function computeNextRunAt(
  config: ScheduleConfig,
  from: Date = new Date(),
): Date {
  const { timeZone, timeOfDay, daysOfWeek } = config;
  const [hourStr, minuteStr] = timeOfDay.split(":");
  const hour = clampInt(parseInt(hourStr, 10), 0, 23);
  const minute = clampInt(parseInt(minuteStr, 10), 0, 59);

  const baseUtc = from;

  // Helper to get local Y/M/D/weekday for a UTC date in the target timezone
  const getLocalParts = (d: Date) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const out: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") out[p.type] = p.value;
    }
    return out;
  };

  // Determine current local offset for the timezone by comparing
  // the "local" representation of now with UTC.
  const nowLocal = getLocalParts(baseUtc);
  const nowLocalMillis = Date.UTC(
    parseInt(nowLocal.year, 10),
    parseInt(nowLocal.month, 10) - 1,
    parseInt(nowLocal.day, 10),
    parseInt(nowLocal.hour, 10),
    parseInt(nowLocal.minute, 10),
  );
  const offsetMillis = nowLocalMillis - baseUtc.getTime();

  const allowedDays =
    daysOfWeek && daysOfWeek.length
      ? new Set(daysOfWeek.map((d) => clampInt(d, 0, 6)))
      : null;

  // Try the next 7 days (including today) to find the next valid run.
  for (let delta = 0; delta < 7; delta++) {
    const candidateUtc = new Date(baseUtc.getTime());
    candidateUtc.setUTCDate(candidateUtc.getUTCDate() + delta);

    const local = getLocalParts(candidateUtc);
    const year = parseInt(local.year, 10);
    const month = parseInt(local.month, 10);
    const day = parseInt(local.day, 10);

    // Map weekday string to 0-6
    const weekdayStr = local.weekday;
    const weekday = weekdayToIndex(weekdayStr);

    if (allowedDays && !allowedDays.has(weekday)) {
      continue;
    }

    const localMillisForTarget = Date.UTC(year, month - 1, day, hour, minute);
    const utcMillisForTarget = localMillisForTarget - offsetMillis;
    const result = new Date(utcMillisForTarget);

    if (result.getTime() > baseUtc.getTime()) {
      return result;
    }
  }

  // Fallback: one day ahead at the same time in timezone.
  const fallback = new Date(baseUtc.getTime());
  fallback.setUTCDate(fallback.getUTCDate() + 1);
  return fallback;
}

function clampInt(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function weekdayToIndex(weekday: string | undefined): number {
  if (!weekday) return 0;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekday] ?? 0;
}
