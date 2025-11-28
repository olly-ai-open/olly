import type { UserSettings } from "./settings-core";

export type EventIgnorePattern =
  | { type: "title_contains"; value: string }
  | { type: "title_regex"; value: string };

export function normalizeIgnorePatterns(
  settings: UserSettings,
): EventIgnorePattern[] {
  const raw = (settings as any).ignoredEventPatterns;
  if (!raw) return [];

  const patterns: EventIgnorePattern[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") {
        patterns.push({ type: "title_contains", value: entry });
      } else if (
        entry &&
        typeof entry === "object" &&
        typeof entry.type === "string" &&
        typeof entry.value === "string"
      ) {
        if (entry.type === "title_contains" || entry.type === "title_regex") {
          patterns.push({
            type: entry.type,
            value: entry.value,
          });
        }
      }
    }
  }

  return patterns;
}

export function shouldIgnoreEventByTitle(
  title: string | null | undefined,
  patterns: EventIgnorePattern[],
): boolean {
  if (!title) return false;
  const trimmed = title.trim();
  if (!trimmed) return false;

  for (const pattern of patterns) {
    if (pattern.type === "title_contains") {
      if (trimmed.toLowerCase().includes(pattern.value.toLowerCase())) {
        return true;
      }
    } else if (pattern.type === "title_regex") {
      try {
        const re = new RegExp(pattern.value, "i");
        if (re.test(trimmed)) return true;
      } catch {
        continue;
      }
    }
  }

  return false;
}
