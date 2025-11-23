"use client";

import { useEffect, useState } from "react";
import {
  MEETING_BRIEF_PROMPT,
  MORNING_BRIEF_PROMPT,
  QUERY_PLANNER_PROMPT,
} from "@olly/core";

interface AdminUserSettings {
  id: string;
  userId: string;
  searchStrategy?: "LLM_ONLY" | "HEURISTIC_ONLY" | "LLM_AND_HEURISTIC" | null;
  briefSystemPrompt?: string | null;
  queryPlannerSystemPrompt?: string | null;
  morningBriefSystemPrompt?: string | null;
}

export default function AdminSettingsForm() {
  const [settings, setSettings] = useState<AdminUserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const resp = await fetch("/api/settings");
        if (resp.ok) {
          const data = await resp.json();
          setSettings({
            id: data.id,
            userId: data.userId,
            searchStrategy: data.searchStrategy,
            briefSystemPrompt: data.briefSystemPrompt,
            queryPlannerSystemPrompt: data.queryPlannerSystemPrompt,
            morningBriefSystemPrompt: data.morningBriefSystemPrompt,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    setMessage("");

    try {
      const resp = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchStrategy: settings.searchStrategy,
          briefSystemPrompt: settings.briefSystemPrompt ?? "",
          queryPlannerSystemPrompt: settings.queryPlannerSystemPrompt ?? "",
          morningBriefSystemPrompt: settings.morningBriefSystemPrompt ?? "",
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        setSettings({
          id: data.id,
          userId: data.userId,
          searchStrategy: data.searchStrategy,
          briefSystemPrompt: data.briefSystemPrompt,
          queryPlannerSystemPrompt: data.queryPlannerSystemPrompt,
          morningBriefSystemPrompt: data.morningBriefSystemPrompt,
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
      <div>
        <h2 className="mb-4 text-lg font-medium">Brief Generation Strategy</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="searchStrategy"
              className="mb-2 block text-sm font-medium text-foreground"
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
                    .value as AdminUserSettings["searchStrategy"],
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
              Controls how Olly searches Gmail and Drive before generating a
              brief.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">LLM System Prompts</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          These settings control how Olly talks to the LLM when generating
          briefs and planning queries. Changes only apply to your account and
          can be reset to the built-in defaults at any time.
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
                prompt. The app will still enforce a strict JSON output format.
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
              value={settings.queryPlannerSystemPrompt ?? QUERY_PLANNER_PROMPT}
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
                Controls how Olly asks the LLM to design Gmail and Drive search
                queries.
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
              value={settings.morningBriefSystemPrompt ?? MORNING_BRIEF_PROMPT}
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
                Controls how Olly summarizes upcoming meetings and highlights
                relevant action items in the morning brief.
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
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
