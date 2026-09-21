"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface GoogleDrivePickerProps {
  accessToken: string;
  onSuccess?: (
    folders: Array<{ id: string; name: string; parents?: string[] }>,
  ) => void;
}

interface PickerFile {
  id: string;
  name: string;
  parents?: string[];
  mimeType: string;
}

export default function GoogleDrivePicker({
  accessToken,
  onSuccess,
}: GoogleDrivePickerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isApiReady, setIsApiReady] = useState(false);
  const router = useRouter();

  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    // Load Google's API loader ourselves and wait for the picker module.
    // Relying on a <Script> tag elsewhere on the page is fragile: after a
    // client-side navigation (for example returning from the OAuth redirect)
    // the tag may not be re-run, and the picker then polls forever.
    let cancelled = false;

    const loadPicker = () => {
      if (window.google?.picker) {
        setIsApiReady(true);
        return;
      }
      window.gapi.load("picker", () => {
        if (!cancelled) setIsApiReady(true);
      });
    };

    if (window.gapi) {
      loadPicker();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]',
    );
    const script = existing ?? document.createElement("script");
    const onLoad = () => {
      if (cancelled) return;
      if (window.gapi) loadPicker();
      else setLoadError("Google's picker library loaded but is unavailable.");
    };
    const onError = () => {
      if (!cancelled)
        setLoadError(
          "Could not load Google's picker library. Check your connection or ad blocker and reload the page.",
        );
    };
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) {
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      document.head.appendChild(script);
    } else if (window.gapi) {
      onLoad();
    }

    const timeout = setTimeout(() => {
      if (!cancelled && !window.gapi) onError();
    }, 15000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
  }, []);

  const openPicker = () => {
    if (!isApiReady || !window.google || !window.google.picker) {
      console.error("Google Picker API not loaded");
      return;
    }

    setIsLoading(true);

    const picker = new window.google.picker.PickerBuilder()
      .addView(
        new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
          .setParent("root")
          .setIncludeFolders(false)
          .setSelectFolderEnabled(true),
      )
      .setOAuthToken(accessToken)
      // .setDeveloperKey() // Not needed when using OAuth token
      .setCallback(handlePickerCallback)
      .setTitle("Select folders to give access to")
      .build();

    picker.setVisible(true);
  };

  const handlePickerCallback = async (data: any) => {
    setIsLoading(false);

    if (data.action === window.google.picker.Action.PICKED) {
      const folders = data.docs
        .filter(
          (doc: PickerFile) =>
            doc.mimeType === "application/vnd.google-apps.folder",
        )
        .map((doc: PickerFile) => ({
          id: doc.id,
          name: doc.name,
          parents: doc.parents,
        }));

      try {
        // Save selected folders to database
        const response = await fetch("/api/drive/folders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ folders }),
        });

        if (response.ok) {
          onSuccess?.(folders);
          router.refresh(); // Refresh to show updated folder list
        } else {
          console.error("Failed to save folders");
        }
      } catch (error) {
        console.error("Error saving folders:", error);
      }
    }
  };

  return (
    <div>
      <button
        onClick={openPicker}
        disabled={isLoading || !isApiReady}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer disabled:opacity-50 hover:bg-border/40"
      >
        {isLoading
          ? "Opening..."
          : !isApiReady
            ? "Loading..."
            : "Select Drive Folders"}
      </button>
      {loadError ? (
        <p className="mt-2 text-xs text-destructive">{loadError}</p>
      ) : null}
    </div>
  );
}

// Extend window type for Google Picker API
declare global {
  interface Window {
    gapi: {
      load: (api: string, callback: () => void) => void;
    };
    google: {
      picker: {
        PickerBuilder: new () => any;
        DocsView: new (viewId: string) => any;
        ViewId: {
          FOLDERS: string;
        };
        Action: {
          PICKED: string;
        };
      };
    };
  }
}
