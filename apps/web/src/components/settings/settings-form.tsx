"use client";

import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";

interface UserSettings {
  id: string;
  userId: string;
  searchTimeframeDays: number;
  briefSystemPrompt?: string | null;
  queryPlannerSystemPrompt?: string | null;
  morningBriefSystemPrompt?: string | null;
  timeZone?: string | null;
  emailNotifications: boolean;
  webNotificationsEnabled: boolean;
  telemetryOptIn: boolean;
  ignoredEventPatterns?: Array<string | { type?: string; value?: string }>;
  workingHoursStart?: string | null;
  workingHoursEnd?: string | null;
  workingDays?: number[] | null;
  meetingBufferMinutes?: number;
  meetingBriefLeadMinutes?: number;
  calendarSyncIntervalMinutes?: number;
  minSchedulingNoticeHours?: number;
  llmProvider?: "openai" | "anthropic" | "gemini" | null;
  llmModel?: string | null;
  llmEffort?: "low" | "medium" | "high" | null;
  llm?: {
    defaultProvider: "openai" | "anthropic" | "gemini";
    available: Record<"openai" | "anthropic" | "gemini", boolean>;
    defaultModels: Record<"openai" | "anthropic" | "gemini", string>;
    keysEditable?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

const LLM_PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Claude (Anthropic)",
  gemini: "Gemini (Google)",
} as const;

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
  days?: { label: string; value: number }[];
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

// ISO weekday numbering (Mon=1..Sun=7), used by scheduling working days
const ISO_WEEKDAYS: { label: string; value: number }[] = [
  { label: "M", value: 1 },
  { label: "T", value: 2 },
  { label: "W", value: 3 },
  { label: "T", value: 4 },
  { label: "F", value: 5 },
  { label: "S", value: 6 },
  { label: "S", value: 7 },
];

function WeekdaySelector({
  value,
  onChange,
  days = WEEKDAYS,
}: WeekdaySelectorProps) {
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
      {days.map((d) => {
        const active = value.includes(d.value);
        return (
          <button
            key={`${d.value}-${d.label}`}
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
  type Provider = "openai" | "anthropic" | "gemini";
  type ModelOption = { id: string; label: string };
  const [keyValue, setKeyValue] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [modelOptions, setModelOptions] = useState<Partial<Record<Provider, ModelOption[]>>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  // The provider in effect for this user: their choice, else the deployment default.
  const effectiveProvider: Provider =
    settings?.llmProvider ?? settings?.llm?.defaultProvider ?? "openai";
  const providerHasKey = Boolean(settings?.llm?.available?.[effectiveProvider]);

  // Load the provider's current model list once the provider has a key.
  useEffect(() => {
    if (!settings || !providerHasKey || modelOptions[effectiveProvider]) return;
    let cancelled = false;
    setModelsLoading(true);
    fetch(`/api/llm/models?provider=${effectiveProvider}`)
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((data) => {
        if (cancelled) return;
        setModelOptions((prev) => ({ ...prev, [effectiveProvider]: data.models || [] }));
      })
      .catch(() => {
        if (!cancelled) setModelOptions((prev) => ({ ...prev, [effectiveProvider]: [] }));
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProvider, providerHasKey, settings?.llm]);

  // If the saved model is not in the provider's list, show the custom field.
  useEffect(() => {
    const list = modelOptions[effectiveProvider];
    if (!settings?.llmModel || !list?.length) return;
    if (!list.some((m) => m.id === settings.llmModel)) setCustomModel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelOptions, effectiveProvider]);

  // Desktop only: save or replace the selected provider's API key. The
  // server applies it immediately, so no restart is needed, and the
  // provider choice is persisted at the same time.
  const saveApiKey = async () => {
    if (!keyValue.trim()) return;
    setKeySaving(true);
    setKeyMessage("");
    try {
      const res = await fetch("/api/setup/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: effectiveProvider, apiKey: keyValue.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKeyMessage(data?.error || "Failed to save the key");
        return;
      }
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmProvider: effectiveProvider, llmModel: null }),
      });
      const fresh = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null));
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              ...(fresh?.llm && { llm: fresh.llm }),
              llmProvider: effectiveProvider,
              llmModel: null,
            }
          : prev,
      );
      setModelOptions((prev) => ({ ...prev, [effectiveProvider]: undefined }));
      setKeyValue("");
      setShowKeyInput(false);
      setCustomModel(false);
      setKeyMessage("Key saved and in use.");
    } catch {
      setKeyMessage("Failed to save the key");
    } finally {
      setKeySaving(false);
    }
  };
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
  const [webPushSupported, setWebPushSupported] = useState(false);
  const [webPushWorking, setWebPushWorking] = useState(false);
  const [webPushError, setWebPushError] = useState("");
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const autoDisableInFlight = useRef(false);

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
      } catch {
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

  useEffect(() => {
    const supported =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setWebPushSupported(supported);
    if (supported) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (
      !settings ||
      notificationPermission !== "denied" ||
      !settings.webNotificationsEnabled ||
      autoDisableInFlight.current
    ) {
      return;
    }

    autoDisableInFlight.current = true;
    saveWebNotificationPreference(false)
      .catch(() => {})
      .finally(() => {
        autoDisableInFlight.current = false;
      });
  }, [notificationPermission, settings]);

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const saveWebNotificationPreference = async (enabled: boolean) => {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webNotificationsEnabled: enabled }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update notification settings");
    }
    const updated = await response.json();
    setSettings(updated);
  };

  const enableWebPush = async () => {
    if (!webPushSupported) {
      throw new Error("This browser does not support web notifications");
    }
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) {
      throw new Error("Missing VAPID public key");
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "denied") {
      throw new Error("notifications_permission_denied");
    }
    if (permission !== "granted") {
      throw new Error("notifications_permission_default");
    }

    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const response = await fetch("/api/notifications/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save notification subscription");
    }
  };

  const disableWebPush = async () => {
    if (webPushSupported) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      if (subscription) {
        await subscription.unsubscribe().catch(() => {});
        await fetch("/api/notifications/web-push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      } else {
        await fetch("/api/notifications/web-push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }
    }
  };

  const handleWebPushToggle = async (enabled: boolean) => {
    if (!settings) return;
    setWebPushError("");
    setWebPushWorking(true);
    try {
      if (enabled) {
        await enableWebPush();
      } else {
        await disableWebPush();
      }
      await saveWebNotificationPreference(enabled);
    } catch (error: any) {
      const message =
        error?.message === "notifications_permission_denied"
          ? "Notifications are blocked for this site. Click the lock icon in your address bar, open Site settings, and allow Notifications."
          : error?.message === "notifications_permission_default"
            ? "Browser notifications are not enabled yet. Allow notifications when prompted to receive alerts."
            : error?.message || "Failed to update web notifications";
      setWebPushError(message);
    } finally {
      setWebPushWorking(false);
    }
  };

  const handleWebPushPermissionRetry = async () => {
    if (!settings) return;
    setWebPushError("");
    setWebPushWorking(true);
    try {
      await enableWebPush();
      if (!settings.webNotificationsEnabled) {
        await saveWebNotificationPreference(true);
      }
    } catch (error: any) {
      const message =
        error?.message === "notifications_permission_denied"
          ? "Notifications are blocked for this site. Click the lock icon in your address bar, open Site settings, and allow Notifications."
          : error?.message === "notifications_permission_default"
            ? "Browser notifications are not enabled yet. Allow notifications when prompted to receive alerts."
            : error?.message || "Failed to enable web notifications";
      setWebPushError(message);
    } finally {
      setWebPushWorking(false);
    }
  };
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
          webNotificationsEnabled: settings.webNotificationsEnabled,
          telemetryOptIn: settings.telemetryOptIn,
          ignoredEventPatterns: parseIgnoredPatterns(ignoredPatternsText),
          workingHoursStart: settings.workingHoursStart ?? null,
          workingHoursEnd: settings.workingHoursEnd ?? null,
          workingDays: settings.workingDays ?? [1, 2, 3, 4, 5],
          meetingBufferMinutes: settings.meetingBufferMinutes ?? 0,
          minSchedulingNoticeHours: settings.minSchedulingNoticeHours ?? 24,
          meetingBriefLeadMinutes: settings.meetingBriefLeadMinutes ?? 5,
          calendarSyncIntervalMinutes: settings.calendarSyncIntervalMinutes ?? 60,
          llmProvider: settings.llmProvider ?? null,
          llmModel: settings.llmModel ?? null,
          llmEffort: settings.llmEffort ?? null,
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
    } catch {
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
        <h2 className="mb-4 text-lg font-medium">AI Model</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="llmProvider"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Provider
            </label>
            <select
              id="llmProvider"
              value={settings.llmProvider ?? ""}
              onChange={(e) => {
                setSettings({
                  ...settings,
                  llmProvider: (e.target.value || null) as UserSettings["llmProvider"],
                  llmModel: null,
                });
                setCustomModel(false);
                setShowKeyInput(false);
                setKeyMessage("");
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">
                Default (
                {LLM_PROVIDER_LABELS[settings.llm?.defaultProvider ?? "openai"]})
              </option>
              {(["anthropic", "openai", "gemini"] as const).map((p) => (
                <option
                  key={p}
                  value={p}
                  disabled={!settings.llm?.available[p] && !settings.llm?.keysEditable}
                >
                  {LLM_PROVIDER_LABELS[p]}
                  {settings.llm?.available[p] ? "" : " (no key yet)"}
                </option>
              ))}
            </select>
            {settings.llm?.keysEditable && providerHasKey && !showKeyInput ? (
              <button
                type="button"
                onClick={() => setShowKeyInput(true)}
                className="mt-1 text-xs text-muted-foreground hover:underline"
              >
                Replace the {LLM_PROVIDER_LABELS[effectiveProvider]} key
              </button>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="llmModel"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Model
            </label>
            {(modelOptions[effectiveProvider]?.length ?? 0) > 0 && !customModel ? (
              <select
                id="llmModel"
                value={settings.llmModel ?? ""}
                onChange={(e) => {
                  if (e.target.value === "__custom__") {
                    setCustomModel(true);
                    return;
                  }
                  setSettings({ ...settings, llmModel: e.target.value || null });
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">
                  Default ({settings.llm?.defaultModels[effectiveProvider]})
                </option>
                {modelOptions[effectiveProvider]!.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom__">Other model ID…</option>
              </select>
            ) : (
              <input
                id="llmModel"
                type="text"
                value={settings.llmModel ?? ""}
                onChange={(e) =>
                  setSettings({ ...settings, llmModel: e.target.value || null })
                }
                placeholder={
                  modelsLoading
                    ? "Loading models…"
                    : (settings.llm?.defaultModels[effectiveProvider] ?? "")
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
            {customModel && (modelOptions[effectiveProvider]?.length ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setCustomModel(false);
                  setSettings({ ...settings, llmModel: null });
                }}
                className="mt-1 text-xs text-muted-foreground hover:underline"
              >
                Choose from the list instead
              </button>
            ) : null}
          </div>
        </div>

        {settings.llm?.keysEditable && (!providerHasKey || showKeyInput) ? (
          <div className="mt-3 rounded-md border border-border/70 p-3">
            <p className="text-xs font-medium text-foreground">
              {providerHasKey
                ? `Replace your ${LLM_PROVIDER_LABELS[effectiveProvider]} key`
                : `Add your ${LLM_PROVIDER_LABELS[effectiveProvider]} key to use it`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Takes effect immediately; no restart needed.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                type="password"
                aria-label="API key"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                placeholder={
                  effectiveProvider === "anthropic"
                    ? "sk-ant-..."
                    : effectiveProvider === "openai"
                      ? "sk-..."
                      : "AIza..."
                }
                autoComplete="new-password"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={saveApiKey}
                disabled={keySaving || !keyValue.trim()}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {keySaving ? "Saving..." : "Save key"}
              </button>
            </div>
          </div>
        ) : null}
        {keyMessage ? (
          <p className="mt-2 text-xs text-muted-foreground">{keyMessage}</p>
        ) : null}
        {!settings.llm?.keysEditable && !providerHasKey ? (
          <p className="mt-2 text-xs text-destructive">
            No key is configured for this provider on this deployment. Ask
            whoever runs it to add one.
          </p>
        ) : null}

        <div className="mt-4 max-w-xs">
          <label
            htmlFor="llmEffort"
            className="mb-1 block text-xs font-medium text-foreground"
          >
            Reasoning effort
          </label>
          <select
            id="llmEffort"
            value={settings.llmEffort ?? ""}
            onChange={(e) =>
              setSettings({
                ...settings,
                llmEffort: (e.target.value || null) as UserSettings["llmEffort"],
              })
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Provider default</option>
            <option value="low">Low (fastest, cheapest)</option>
            <option value="medium">Medium</option>
            <option value="high">High (most thorough)</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            How hard newer models think before answering. Only sent to models
            that accept it; others ignore this setting.
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The model list comes from your provider, so newer models appear as
          they are released. Leave it on Default to follow Olly&apos;s
          recommended model.
        </p>
      </div>

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
        <h2 className="mb-4 text-lg font-medium">Scheduling Preferences</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Used when Olly finds meeting times on your behalf. Proposed slots
          always stay within these bounds and avoid your existing meetings.
        </p>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="workingHoursStart"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Earliest meeting time
              </label>
              <input
                id="workingHoursStart"
                type="time"
                value={settings.workingHoursStart ?? "09:00"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    workingHoursStart: e.target.value,
                  })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label
                htmlFor="workingHoursEnd"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Latest meeting end time
              </label>
              <input
                id="workingHoursEnd"
                type="time"
                value={settings.workingHoursEnd ?? "17:00"}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    workingHoursEnd: e.target.value,
                  })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Days available for meetings
            </label>
            <WeekdaySelector
              days={ISO_WEEKDAYS}
              value={settings.workingDays ?? [1, 2, 3, 4, 5]}
              onChange={(days) =>
                setSettings({ ...settings, workingDays: days })
              }
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="meetingBufferMinutes"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Buffer between meetings
              </label>
              <select
                id="meetingBufferMinutes"
                value={settings.meetingBufferMinutes ?? 0}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    meetingBufferMinutes: parseInt(e.target.value, 10),
                  })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={0}>None</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="minSchedulingNoticeHours"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Minimum notice for new meetings
              </label>
              <select
                id="minSchedulingNoticeHours"
                value={settings.minSchedulingNoticeHours ?? 24}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    minSchedulingNoticeHours: parseInt(e.target.value, 10),
                  })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value={0}>No minimum</option>
                <option value={4}>4 hours</option>
                <option value={12}>12 hours</option>
                <option value={24}>1 day</option>
                <option value={48}>2 days</option>
                <option value={72}>3 days</option>
              </select>
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
              Email me each brief
            </label>
          </div>
          <p className="text-xs text-muted-foreground ml-7">
            Morning briefs, end of day summaries, and meeting briefs are sent
            to your inbox from your own Gmail account as soon as they are
            generated. Needs the send-email permission; reconnect Google on
            the Integrations page if emails do not arrive.
          </p>
          <div className="ml-7 max-w-xs">
            <label
              htmlFor="meetingBriefLeadMinutes"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Prepare meeting briefs
            </label>
            <select
              id="meetingBriefLeadMinutes"
              value={settings.meetingBriefLeadMinutes ?? 5}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  meetingBriefLeadMinutes: parseInt(e.target.value, 10),
                })
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={5}>5 minutes before the meeting</option>
              <option value={10}>10 minutes before the meeting</option>
              <option value={15}>15 minutes before the meeting</option>
              <option value={30}>30 minutes before the meeting</option>
              <option value={60}>1 hour before the meeting</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              The brief is generated and emailed at this point. Briefs are
              only prepared while Olly is running.
            </p>
          </div>
          <div className="ml-7 max-w-xs">
            <label
              htmlFor="calendarSyncIntervalMinutes"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Check calendar for new meetings
            </label>
            <select
              id="calendarSyncIntervalMinutes"
              value={settings.calendarSyncIntervalMinutes ?? 60}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  calendarSyncIntervalMinutes: parseInt(e.target.value, 10),
                })
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Meetings added to your calendar less than this long before they
              start may not get a brief. Checking more often does more
              background work; on the desktop app that only affects your own
              machine.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <input
              id="webNotificationsEnabled"
              type="checkbox"
              checked={settings.webNotificationsEnabled}
              onChange={(e) => handleWebPushToggle(e.target.checked)}
              disabled={webPushWorking || !webPushSupported}
              className="h-4 w-4 rounded border border-border text-primary focus:ring-primary disabled:cursor-not-allowed"
            />
            <label
              htmlFor="webNotificationsEnabled"
              className="text-sm font-medium text-foreground"
            >
              Browser notifications
            </label>
          </div>
          <p className="text-xs text-muted-foreground ml-7">
            Receive browser notifications when scheduled briefs are ready
          </p>
          {!webPushSupported ? (
            <p className="text-xs text-muted-foreground ml-7">
              This browser does not support web notifications.
            </p>
          ) : null}
          {settings.webNotificationsEnabled &&
          notificationPermission !== "granted" ? (
            <p className="text-xs text-destructive ml-7">
              {notificationPermission === "denied"
                ? "Notifications are blocked for this site. Click the lock icon in your address bar, open Site settings, and allow Notifications."
                : "Browser notifications are not enabled yet. Allow notifications when prompted to receive alerts."}
            </p>
          ) : null}
          {webPushSupported && notificationPermission === "default" ? (
            <div className="ml-7">
              <button
                type="button"
                onClick={handleWebPushPermissionRetry}
                disabled={webPushWorking}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-border/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Enable in browser
              </button>
            </div>
          ) : null}
          {webPushError ? (
            <p className="text-xs text-destructive ml-7">{webPushError}</p>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-medium">Privacy</h2>
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <input
              id="telemetryOptIn"
              type="checkbox"
              checked={settings.telemetryOptIn}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  telemetryOptIn: e.target.checked,
                })
              }
              className="h-4 w-4 rounded border border-border text-primary focus:ring-primary"
            />
            <label
              htmlFor="telemetryOptIn"
              className="text-sm font-medium text-foreground"
            >
              Make Olly better
            </label>
          </div>
          <p className="text-xs text-muted-foreground ml-7">
            Share anonymized traces to improve brief quality and reliability.
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
