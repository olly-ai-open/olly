"use client";

import { useState, useEffect } from "react";

interface UserSettings {
  id: string;
  userId: string;
  searchTimeframeDays: number;
  emailNotifications: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function SettingsForm() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
