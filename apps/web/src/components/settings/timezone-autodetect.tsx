"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Saves the browser's time zone as the user's setting, once, when they have
 * never chosen one.
 *
 * On the desktop app the server runs on the user's machine, so the fallback
 * zone is already correct. On a hosted server the fallback is the server's
 * zone, usually UTC, and every brief and meeting time would be off until the
 * user visited Settings. This closes that gap without any UI.
 */
export default function TimezoneAutodetect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      let browserZone = "";
      try {
        browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      } catch {
        return;
      }
      if (!browserZone) return;

      try {
        const resp = await fetch("/api/settings");
        if (!resp.ok) return;
        const settings = (await resp.json()) as {
          timeZone?: string | null;
          timeZoneIsDefault?: boolean;
        };
        if (cancelled || !settings.timeZoneIsDefault) return;
        if (settings.timeZone === browserZone) return;

        const save = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeZone: browserZone }),
        });
        if (save.ok && !cancelled) router.refresh();
      } catch {
        // Best effort only; the user can still pick a zone in Settings.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
