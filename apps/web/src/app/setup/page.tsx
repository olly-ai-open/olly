"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff, Loader2 } from "lucide-react";

type Provider = "anthropic" | "openai" | "gemini";

type OllyDesktop = { isDesktop?: boolean; restart?: () => void };

const RESTART_SECONDS = 5;

function getDesktop(): OllyDesktop | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { ollyDesktop?: OllyDesktop }).ollyDesktop;
}

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini (Google)" },
];

const PROVIDER_COPY: Record<
  Provider,
  { label: string; placeholder: string; keyUrl: string; keyHost: string }
> = {
  anthropic: {
    label: "Claude / Anthropic API key",
    placeholder: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHost: "console.anthropic.com",
  },
  openai: {
    label: "OpenAI API key",
    placeholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHost: "platform.openai.com",
  },
  gemini: {
    label: "Gemini API key",
    placeholder: "AIza...",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHost: "aistudio.google.com",
  },
};

export default function SetupPage() {
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESTART_SECONDS);

  const copy = PROVIDER_COPY[provider];

  useEffect(() => {
    setIsDesktop(Boolean(getDesktop()?.isDesktop));
  }, []);

  const restart = useCallback(() => {
    getDesktop()?.restart?.();
  }, []);

  // After a successful save in the desktop app, count down and relaunch.
  useEffect(() => {
    if (!saved || !isDesktop) return;

    if (secondsLeft <= 0) {
      restart();
      return;
    }

    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [saved, isDesktop, secondsLeft, restart]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const res = await fetch("/api/setup/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Failed to save settings");
        return;
      }

      setSecondsLeft(RESTART_SECONDS);
      setSaved(true);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-border bg-card p-8 shadow-card">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/olly-mascot.png"
              alt="Olly"
              width={56}
              height={56}
              className="h-14 w-14 rounded-full bg-background p-1 shadow-card"
              priority
            />
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              Set up Olly
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose your AI provider and add an API key to get started.
            </p>
          </div>

          {saved ? (
            <div className="mt-6 rounded-md border border-success/40 bg-success/5 p-4 text-center">
              <p className="text-sm font-medium text-foreground">
                API key saved
              </p>
              {isDesktop ? (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Olly needs to restart to finish setting up. Restarting
                    automatically in {secondsLeft}s…
                  </p>
                  <button
                    type="button"
                    onClick={restart}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Restart now
                  </button>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Please quit and reopen Olly to finish setting up.
                </p>
              )}
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-6 space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-foreground">
                  Provider
                </label>
                <div className="inline-flex w-full rounded-md border border-border bg-background p-1">
                  {PROVIDERS.map((p) => {
                    const active = provider === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setProvider(p.value)}
                        className={[
                          "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-border/40 hover:text-foreground",
                        ].join(" ")}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="api-key"
                  className="block text-xs font-medium text-foreground"
                >
                  {copy.label}
                </label>
                <div className="relative">
                  <input
                    id="api-key"
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={copy.placeholder}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 font-mono text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                    aria-pressed={showKey}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus:outline-none"
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get a key from{" "}
                  <a
                    href={copy.keyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-secondary-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {copy.keyHost}
                  </a>
                  . Stored locally on this device — never sent to Olly&apos;s
                  servers.
                </p>
              </div>

              {error ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={saving || !apiKey.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Saving...
                  </>
                ) : (
                  "Save and continue"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
