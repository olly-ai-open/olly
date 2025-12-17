"use client";

import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";

interface UserSettings {
  id: string;
  userId: string;
  searchTimeframeDays: number;
  searchStrategy?: "LLM_ONLY" | "HEURISTIC_ONLY" | "LLM_AND_HEURISTIC" | null;
  briefSystemPrompt?: string | null;
  queryPlannerSystemPrompt?: string | null;
  morningBriefSystemPrompt?: string | null;
  timeZone?: string | null;
  emailNotifications: boolean;
  ignoredEventPatterns?: Array<string | { type?: string; value?: string }>;
  createdAt: string;
  updatedAt: string;
}

interface Schedule {
  id?: string;
  userId?: string;
  type: "MORNING_BRIEF" | "EVENING_BRIEF" | string;
  timeZone?: string | null;
  timeOfDay: string;
  daysOfWeek?: number[] | null;
  active?: boolean;
  nextRunAt?: string | null;
}

interface WeekdaySelectorProps {
  value: number[];
  onChange: (value: number[]) => void;
}

const WEEKDAYS: { label: string; value: number }[] = [
  { label: "S", value: 0 },
  { label: "M", value: 1 },
  { label: "T", value: 2 },
  { label: "W", value: 3 },
  { label: "T", value: 4 },
  { label: "F", value: 5 },
  { label: "S", value: 6 },
];

function WeekdaySelector({ value, onChange }: WeekdaySelectorProps) {
  const toggle = (day: number) => {
    const set = new Set(value);
    if (set.has(day)) {
      set.delete(day);
    } else {
      set.add(day);
    }
    const next = Array.from(set).sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div className="inline-flex rounded-md border border-border bg-background p-1">
      {WEEKDAYS.map((d) => {
        const active = value.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            onClick={() => toggle(d.value)}
            className={[
              "mx-0.5 h-7 w-7 rounded text-xs font-medium",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-border/40",
            ].join(" ")}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsForm() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [timeZones, setTimeZones] = useState<string[]>([
    "UTC",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
  ]);
  const [ignoredPatternsText, setIgnoredPatternsText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
          if (Array.isArray(data?.ignoredEventPatterns)) {
            const lines = data.ignoredEventPatterns
              .map((p: any) =>
                typeof p === "string"
                  ? p
                  : p?.value
                    ? `${p.type || "title_contains"}:${p.value}`
                    : "",
              )
              .filter(Boolean)
              .join("\n");
            setIgnoredPatternsText(lines);
          }
        } else {
          setMessage("Failed to load settings");
        }
      } catch (error) {
        setMessage("Failed to load settings");
      } finally {
      }
    };
    const loadSchedules = async () => {
      try {
        const response = await fetch("/api/schedules");
        if (response.ok) {
          const data = (await response.json()) as Schedule[];
          setSchedules(data);
        }
      } catch {
        // ignore for now; user can still edit settings
      }
    };
    Promise.all([loadSettings(), loadSchedules()]).finally(() =>
      setLoading(false),
    );

    // Populate full timezone list when available in the browser
    try {
      if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
        const all = (Intl as any).supportedValuesOf("timeZone") as string[];
        if (Array.isArray(all) && all.length) {
          setTimeZones(all);
        }
      }
    } catch {
      // Fallback to the small default list above
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchTimeframeDays: settings.searchTimeframeDays,
          timeZone: settings.timeZone ?? "UTC",
          emailNotifications: settings.emailNotifications,
          ignoredEventPatterns: parseIgnoredPatterns(ignoredPatternsText),
        }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
      } else {
        const error = await response.json();
        setMessage(error.error || "Failed to save settings");
        return;
      }
    } catch (error) {
      setMessage("Failed to save settings");
      setSaving(false);
      return;
    }

    // Save schedules (morning and evening) if we have them
    try {
      const morning = getScheduleForType("MORNING_BRIEF");
      const evening = getScheduleForType("EVENING_BRIEF");

      const updates: Promise<Response>[] = [];
      if (morning) updates.push(saveSchedule(morning));
      if (evening) updates.push(saveSchedule(evening));

      if (updates.length) {
        const results = await Promise.all(updates);
        const failed = results.find((r) => !r.ok);
        if (failed) {
          const err = await failed.json().catch(() => ({}));
          setMessage(err.error || "Failed to save schedules");
          setSaving(false);
          return;
        }
      }

      setMessage("Settings saved successfully");
      setTimeout(() => setMessage(""), 3000);
    } catch {
      setMessage("Failed to save schedules");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteMessage("");
    setDeleting(true);
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setDeleteMessage(error.error || "Failed to delete account");
        setDeleting(false);
        return;
      }

      setDeleteMessage("Account deleted. Signing you out...");
      await signOut({ callbackUrl: "/" });
    } catch {
      setDeleteMessage("Failed to delete account");
      setDeleting(false);
    }
  };

  const getScheduleForType = (type: "MORNING_BRIEF" | "EVENING_BRIEF") => {
    if (!schedules) return null;
    const existing = schedules.find((s) => s.type === type);
    return existing || null;
  };

  const parseIgnoredPatterns = (
    text: string,
  ): Array<string | { type: string; value: string }> => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line) => {
      const [type, ...rest] = line.split(":");
      if (rest.length && type) {
        return { type: type.trim(), value: rest.join(":").trim() };
      }
      return line;
    });
  };

  const updateScheduleLocal = (
    type: "MORNING_BRIEF" | "EVENING_BRIEF",
    patch: Partial<{
      timeOfDay: string;
      daysOfWeek: number[];
      active: boolean;
    }>,
  ) => {
    setSchedules((prev) => {
      const current = prev || [];
      const existing = current.find((s) => s.type === type);
      if (existing) {
        return current.map((s) => (s.type === type ? { ...s, ...patch } : s));
      }
      return [
        ...current,
        {
          type,
          timeOfDay:
            patch.timeOfDay ?? (type === "MORNING_BRIEF" ? "09:00" : "17:30"),
          daysOfWeek: patch.daysOfWeek ?? [1, 2, 3, 4, 5],
          active: patch.active ?? true,
        },
      ];
    });
  };

  const saveSchedule = async (schedule: any) => {
    return fetch("/api/schedules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: schedule.type,
        timeOfDay: schedule.timeOfDay,
        daysOfWeek: schedule.daysOfWeek,
        active: schedule.active,
      }),
    });
  };

  const formatNextRun = (schedule: Schedule | null): string => {
    if (!schedule || !schedule.nextRunAt) return "Not scheduled yet";
    if (schedule.active === false) return "Disabled";
    try {
      const date = new Date(schedule.nextRunAt);
      const tz = settings?.timeZone || schedule.timeZone || "UTC";
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      return formatter.format(date) + ` (${tz})`;
    } catch {
      return schedule.nextRunAt;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-destructive">Failed to load settings</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-medium">Search Preferences</h2>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="ignoredPatterns"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Ignore events with titles matching
            </label>
            <textarea
              id="ignoredPatterns"
              value={ignoredPatternsText}
              onChange={(e) => setIgnoredPatternsText(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={`Examples:\nlunch\nOOO\ntitle_regex:^focus block$`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              One rule per line. Format can be just text (matched anywhere in
              the title) or <code>title_regex:pattern</code>.
            </p>
          </div>
          <div>
            <label
              htmlFor="searchTimeframe"
              className="block text-sm font-medium text-foreground mb-2"
            >
              How far back to search for emails and documents
            </label>
            <select
              id="searchTimeframe"
              value={settings.searchTimeframeDays}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  searchTimeframeDays: parseInt(e.target.value, 10),
                })
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>1 week</option>
              <option value={14}>2 weeks</option>
              <option value={30}>1 month</option>
              <option value={60}>2 months</option>
              <option value={90}>3 months</option>
              <option value={180}>6 months</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              This affects both Gmail and Google Drive searches when generating
              briefs
            </p>
          </div>
          <div>
            <label
              htmlFor="timeZone"
              className="mb-2 block text-sm font-medium text-foreground"
            >
              Time zone
            </label>
            <select
              id="timeZone"
              value={settings.timeZone ?? "UTC"}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  timeZone: e.target.value,
                })
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {timeZones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Defaults to <code>UTC</code> if you don&apos;t choose a region.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Brief Schedule</h2>
        <div className="space-y-6">
          {/* Morning brief */}
          <div className="rounded-md border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Morning brief
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Next run: {formatNextRun(getScheduleForType("MORNING_BRIEF"))}
                </p>
              </div>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={getScheduleForType("MORNING_BRIEF")?.active ?? false}
                  onChange={(e) =>
                    updateScheduleLocal("MORNING_BRIEF", {
                      active: e.target.checked,
                    })
                  }
                  className="h-3 w-3 rounded border border-border text-primary focus:ring-primary"
                />
                <span className="text-muted-foreground">Enabled</span>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="morningTime"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Time of day
                </label>
                <input
                  id="morningTime"
                  type="time"
                  value={
                    getScheduleForType("MORNING_BRIEF")?.timeOfDay ?? "09:00"
                  }
                  onChange={(e) =>
                    updateScheduleLocal("MORNING_BRIEF", {
                      timeOfDay: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Days of week
                </label>
                <WeekdaySelector
                  value={
                    getScheduleForType("MORNING_BRIEF")?.daysOfWeek ?? [
                      1, 2, 3, 4, 5,
                    ]
                  }
                  onChange={(days) =>
                    updateScheduleLocal("MORNING_BRIEF", { daysOfWeek: days })
                  }
                />
              </div>
            </div>
          </div>

          {/* Evening brief */}
          <div className="rounded-md border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Evening brief
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Next run: {formatNextRun(getScheduleForType("EVENING_BRIEF"))}
                </p>
              </div>
              <label className="flex items-center space-x-2 text-xs">
                <input
                  type="checkbox"
                  checked={getScheduleForType("EVENING_BRIEF")?.active ?? false}
                  onChange={(e) =>
                    updateScheduleLocal("EVENING_BRIEF", {
                      active: e.target.checked,
                    })
                  }
                  className="h-3 w-3 rounded border border-border text-primary focus:ring-primary"
                />
                <span className="text-muted-foreground">Enabled</span>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="eveningTime"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Time of day
                </label>
                <input
                  id="eveningTime"
                  type="time"
                  value={
                    getScheduleForType("EVENING_BRIEF")?.timeOfDay ?? "17:30"
                  }
                  onChange={(e) =>
                    updateScheduleLocal("EVENING_BRIEF", {
                      timeOfDay: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Days of week
                </label>
                <WeekdaySelector
                  value={
                    getScheduleForType("EVENING_BRIEF")?.daysOfWeek ?? [
                      1, 2, 3, 4, 5,
                    ]
                  }
                  onChange={(days) =>
                    updateScheduleLocal("EVENING_BRIEF", { daysOfWeek: days })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Notification Preferences</h2>

        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <input
              id="emailNotifications"
              type="checkbox"
              checked={settings.emailNotifications}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  emailNotifications: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border border-border text-primary focus:ring-primary"
            />
            <label
              htmlFor="emailNotifications"
              className="text-sm font-medium text-foreground"
            >
              Email notifications
            </label>
          </div>
          <p className="text-xs text-muted-foreground ml-7">
            Receive email notifications when briefs are ready
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-medium">Delete Account</h2>
        <p className="mt-1 text-sm">
          Permanently delete your data. This cannot be undone.
        </p>
      </div>
      <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
        <div className="grid gap-3 sm:grid-cols-[2fr,1fr]">
          <label className="text-sm text-foreground">
            Type <code>DELETE</code> to confirm
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-destructive focus:outline-none focus:ring-1 focus:ring-destructive"
              placeholder="DELETE"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={
                deleting ||
                deleteConfirm.trim().toUpperCase() !== "DELETE" ||
                loading
              }
              className="w-full rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete account"}
            </button>
          </div>
        </div>

        {deleteMessage ? (
          <p className="text-sm text-destructive">{deleteMessage}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div>
          {message && (
            <p
              className={`text-sm ${
                message.includes("success")
                  ? "text-green-600"
                  : "text-destructive"
              }`}
            >
              {message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
