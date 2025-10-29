"use client";
import { useEffect, useMemo, useState } from "react";

type ThemeMode = "light" | "dark" | "system";

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "light" || stored === "system") return stored;
  } catch {}
  return "system";
}

export default function ThemeToggle() {
  // Initialize with 'system' to match SSR output; then sync on mount.
  const [mode, setMode] = useState<ThemeMode>('system');
  useEffect(() => {
    setMode(getInitialMode());
  }, []);

  // Apply theme based on mode and system preference
  useEffect(() => {
    const root = document.documentElement;
    const shouldDark = mode === "dark" || (mode === "system" && (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches));
    root.classList.toggle("dark", shouldDark);
    try { localStorage.setItem("theme", mode); } catch {}
  }, [mode]);

  // React to system theme changes when in "system" mode
  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (!mql) return;
    const handler = () => {
      const root = document.documentElement;
      root.classList.toggle("dark", mql.matches);
    };
    try { mql.addEventListener("change", handler); } catch { mql.addListener(handler); }
    return () => {
      try { mql.removeEventListener("change", handler); } catch { mql.removeListener(handler); }
    };
  }, [mode]);

  const nextMode = (m: ThemeMode): ThemeMode => (m === "light" ? "dark" : m === "dark" ? "system" : "light");
  const icon = mode === "dark" ? "🌙" : mode === "light" ? "☀️" : "🖥️";
  const label = mode === "dark" ? "Dark" : mode === "light" ? "Light" : "System";
  const title = `Theme: ${label} (click to switch)`;

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => setMode((m) => nextMode(m))}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-border/30"
      title={title}
    >
      <span className="text-xs">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
