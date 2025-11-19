"use client";

import { useState, useEffect } from "react";
import { MEETING_BRIEF_PROMPT } from "@/lib/prompts/meetingBriefPrompt";
import { MORNING_BRIEF_PROMPT } from "@/lib/prompts/morningBriefPrompt";
import { QUERY_PLANNER_PROMPT } from "@/lib/prompts/queryPlannerPrompt";

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
  createdAt: string;
  updatedAt: string;
}

interface SettingsFormProps {
  isAdmin: boolean;
}

export default function SettingsForm({ isAdmin }: SettingsFormProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
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

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const data = await response.json();
          setSettings(data);
        } else {
          setMessage("Failed to load settings");
        }
      } catch (error) {
        setMessage("Failed to load settings");
      } finally {
        setLoading(false);
      }
    };
    loadSettings();

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
          // Only send searchStrategy if admin
          ...(isAdmin && settings.searchStrategy
            ? { searchStrategy: settings.searchStrategy }
            : {}),
          ...(isAdmin
            ? {
                briefSystemPrompt: settings.briefSystemPrompt ?? "",
                queryPlannerSystemPrompt:
                  settings.queryPlannerSystemPrompt ?? "",
                morningBriefSystemPrompt:
                  settings.morningBriefSystemPrompt ?? "",
              }
            : {}),
          timeZone: settings.timeZone ?? "UTC",
          emailNotifications: settings.emailNotifications,
        }),
      });

      if (response.ok) {
        const updatedSettings = await response.json();
        setSettings(updatedSettings);
        setMessage("Settings saved successfully");
        setTimeout(() => setMessage(""), 3000);
      } else {
        const error = await response.json();
        setMessage(error.error || "Failed to save settings");
      }
    } catch (error) {
      setMessage("Failed to save settings");
    } finally {
      setSaving(false);
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
          {isAdmin && (
            <div className="pt-4 border-t border-border">
              <h3 className="mb-3 text-sm font-semibold text-foreground">
                Admin Settings
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                These settings control how Olly talks to the LLM when generating
                briefs and planning queries. Changes only apply to your account
                and can be cleared at any time.
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="searchStrategy"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Query strategy for generating briefs
                  </label>
                  <select
                    id="searchStrategy"
                    value={settings.searchStrategy ?? "HEURISTIC_ONLY"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        searchStrategy: e.target
                          .value as UserSettings["searchStrategy"],
                      })
                    }
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="HEURISTIC_ONLY">
                      Heuristic only (no LLM query planning)
                    </option>
                    <option value="LLM_ONLY">
                      LLM only (use model-planned queries)
                    </option>
                    <option value="LLM_AND_HEURISTIC">
                      LLM + heuristic (combine both)
                    </option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Controls how Olly searches Gmail and Drive before generating
                    a brief.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="briefSystemPrompt"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Brief generation system prompt
                  </label>
                  <textarea
                    id="briefSystemPrompt"
                    value={settings.briefSystemPrompt ?? MEETING_BRIEF_PROMPT}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        briefSystemPrompt: e.target.value,
                      })
                    }
                    rows={6}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Leave empty to use the default brief generation prompt."
                  />
                  <div className="flex items-center justify-between">
                    <p className="mt-1 text-xs text-muted-foreground">
                      If set, this replaces the default brief generation system
                      prompt. The app will still enforce a strict JSON output
                      format.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          briefSystemPrompt: "",
                        })
                      }
                      className="ml-4 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-border/20"
                    >
                      Reset to default
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="queryPlannerSystemPrompt"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Query planner system prompt
                  </label>
                  <textarea
                    id="queryPlannerSystemPrompt"
                    value={
                      settings.queryPlannerSystemPrompt ?? QUERY_PLANNER_PROMPT
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        queryPlannerSystemPrompt: e.target.value,
                      })
                    }
                    rows={6}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Leave empty to use the default query planner prompt."
                  />
                  <div className="flex items-center justify-between">
                    <p className="mt-1 text-xs text-muted-foreground">
                      Controls how Olly asks the LLM to design Gmail and Drive
                      search queries. The app will still expect a JSON object
                      with drive_queries and gmail_queries.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          queryPlannerSystemPrompt: "",
                        })
                      }
                      className="ml-4 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-border/20"
                    >
                      Reset to default
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="morningBriefSystemPrompt"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Morning brief system prompt
                  </label>
                  <textarea
                    id="morningBriefSystemPrompt"
                    value={
                      settings.morningBriefSystemPrompt ?? MORNING_BRIEF_PROMPT
                    }
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        morningBriefSystemPrompt: e.target.value,
                      })
                    }
                    rows={6}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Leave empty to use the default morning brief prompt."
                  />
                  <div className="flex items-center justify-between">
                    <p className="mt-1 text-xs text-muted-foreground">
                      Controls how Olly summarizes the day&apos;s upcoming
                      meetings and highlights relevant action items in the
                      morning brief.
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          morningBriefSystemPrompt: "",
                        })
                      }
                      className="ml-4 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-border/20"
                    >
                      Reset to default
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
