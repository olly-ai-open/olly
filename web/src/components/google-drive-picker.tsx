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

  useEffect(() => {
    // Function to initialize Google Picker API
    const initializeGoogleApi = () => {
      if (window.gapi) {
        window.gapi.load("picker", () => {
          console.log("Google Picker API loaded");
          setIsApiReady(true);
        });
        return true;
      }
      return false;
    };

    // Function to check if Google APIs are available
    const checkGoogleApi = () => {
      // If picker is already loaded
      if (window.google && window.google.picker) {
        setIsApiReady(true);
        return true;
      }

      // If gapi is available but picker not loaded, initialize it
      if (window.gapi) {
        return initializeGoogleApi();
      }

      return false;
    };

    // Check immediately
    if (checkGoogleApi()) {
      return;
    }

    // If not ready, check periodically
    const interval = setInterval(() => {
      if (checkGoogleApi()) {
        clearInterval(interval);
      }
    }, 100);

    // Cleanup interval after 10 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
      console.error("Google API failed to load within 10 seconds");
    }, 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
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
          .setIncludeFolders(true)
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
