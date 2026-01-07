"use client";

import { useEffect, useState } from "react";
import { MEETING_BRIEF_PROMPT } from "@olly/core/prompts/meetingBriefPrompt";
import { MORNING_BRIEF_PROMPT } from "@olly/core/prompts/morningBriefPrompt";
import { END_OF_DAY_BRIEF_PROMPT } from "@olly/core/prompts/endOfDayBriefPrompt";
import { QUERY_PLANNER_PROMPT } from "@olly/core/prompts/queryPlannerPrompt";
import {
  getAdminModeEnabled,
  setAdminModeEnabled,
  subscribeAdminModeEnabled,
} from "@/lib/adminMode";

interface AdminUserSettings {
  id: string;
  userId: string;
  briefSystemPrompt?: string | null;
  queryPlannerSystemPrompt?: string | null;
  morningBriefSystemPrompt?: string | null;
  endOfDayBriefSystemPrompt?: string | null;
}

export default function AdminSettingsForm() {
  const [settings, setSettings] = useState<AdminUserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [adminModeOn, setAdminModeOn] = useState(() => getAdminModeEnabled());

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetch("/api/settings");
        if (resp.ok) {
          const data = await resp.json();
          setSettings({
            id: data.id,
            userId: data.userId,
            briefSystemPrompt: data.briefSystemPrompt,
            queryPlannerSystemPrompt: data.queryPlannerSystemPrompt,
            morningBriefSystemPrompt: data.morningBriefSystemPrompt,
            endOfDayBriefSystemPrompt: data.endOfDayBriefSystemPrompt,
          });
        } else {
          setMessage("Failed to load admin settings");
        }
      } catch {
        setMessage("Failed to load admin settings");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => subscribeAdminModeEnabled(setAdminModeOn), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    if (!adminModeOn) return;

    setSaving(true);
    setMessage("");

    try {
      const resp = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          briefSystemPrompt: settings.briefSystemPrompt ?? "",
          queryPlannerSystemPrompt: settings.queryPlannerSystemPrompt ?? "",
          morningBriefSystemPrompt: settings.morningBriefSystemPrompt ?? "",
          endOfDayBriefSystemPrompt: settings.endOfDayBriefSystemPrompt ?? "",
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        setSettings({
          id: data.id,
          userId: data.userId,
          briefSystemPrompt: data.briefSystemPrompt,
          queryPlannerSystemPrompt: data.queryPlannerSystemPrompt,
          morningBriefSystemPrompt: data.morningBriefSystemPrompt,
          endOfDayBriefSystemPrompt: data.endOfDayBriefSystemPrompt,
        });
        setMessage("Admin settings saved successfully");
        setTimeout(() => setMessage(""), 3000);
      } else {
        const err = await resp.json().catch(() => ({}));
        setMessage(err.error || "Failed to save admin settings");
      }
    } catch {
      setMessage("Failed to save admin settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading admin settings...
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="py-8 text-sm text-destructive">
        Unable to load admin settings.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-md border border-border p-4">
        <h2 className="mb-2 text-lg font-medium">Admin Mode</h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={adminModeOn}
            onChange={(e) => {
              const next = e.target.checked;
              setAdminModeOn(next);
              setAdminModeEnabled(next);
            }}
            className="h-4 w-4 rounded border border-border text-primary focus:ring-primary"
          />
          <span className="text-foreground">Enable admin mode</span>
        </label>
        <p className="mt-2 text-xs text-muted-foreground">
          Turn this off to use Olly like a normal user. While disabled, admin
          navigation and admin-only settings are hidden/locked.
        </p>
      </div>

      {!adminModeOn ? (
        <div className="rounded-md border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            Admin mode is currently disabled. Re-enable it above to access
            admin-only settings.
          </p>
        </div>
      ) : null}

      {adminModeOn ? (
        <>
          <div className="rounded-md border border-border p-4">
            <h2 className="mb-4 text-lg font-medium">LLM System Prompts</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              These settings control how Olly talks to the LLM when generating
              briefs and planning queries. Changes only apply to your account
              and can be reset to the built-in defaults at any time.
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="briefSystemPrompt"
                  className="mb-2 block text-sm font-medium text-foreground"
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
                  className="mb-2 block text-sm font-medium text-foreground"
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
                    search queries.
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
                  className="mb-2 block text-sm font-medium text-foreground"
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
                    Controls how Olly summarizes upcoming meetings and
                    highlights relevant action items in the morning brief.
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

              <div className="space-y-2">
                <label
                  htmlFor="endOfDayBriefSystemPrompt"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  End of day summary system prompt
                </label>
                <textarea
                  id="endOfDayBriefSystemPrompt"
                  value={
                    settings.endOfDayBriefSystemPrompt ??
                    END_OF_DAY_BRIEF_PROMPT
                  }
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      endOfDayBriefSystemPrompt: e.target.value,
                    })
                  }
                  rows={6}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Leave empty to use the default end-of-day prompt."
                />
                <div className="flex items-center justify-between">
                  <p className="mt-1 text-xs text-muted-foreground">
                    If set, this replaces the default end-of-day summary system
                    prompt.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings({
                        ...settings,
                        endOfDayBriefSystemPrompt: "",
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
        </>
      ) : null}

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
          disabled={saving || !adminModeOn}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
