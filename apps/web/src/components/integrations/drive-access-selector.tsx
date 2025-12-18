"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DriveAccessSelectorProps {
  currentAccess: "full" | "folders";
}

export default function DriveAccessSelector({
  currentAccess,
}: DriveAccessSelectorProps) {
  const [driveAccess, setDriveAccess] = useState(currentAccess);
  const [isUpdating, setIsUpdating] = useState(false);
  const router = useRouter();

  const handleAccessChange = async (newAccess: "full" | "folders") => {
    if (newAccess === driveAccess) return;

    setIsUpdating(true);
    try {
      const response = await fetch("/api/integrations/google/drive-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ driveAccess: newAccess }),
      });

      if (response.ok) {
        setDriveAccess(newAccess);
        router.refresh(); // Refresh to update the UI
      } else {
        console.error("Failed to update drive access");
      }
    } catch (error) {
      console.error("Error updating drive access:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Drive Access Level</div>
      <div className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="driveAccess"
            value="folders"
            checked={driveAccess === "folders"}
            onChange={() => handleAccessChange("folders")}
            disabled={isUpdating}
            className="w-4 h-4"
          />
          <div>
            <div className="text-sm font-medium">Selected Folders Only</div>
            <div className="text-xs text-muted-foreground">
              Search only in specific folders you choose
            </div>
          </div>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="driveAccess"
            value="full"
            checked={driveAccess === "full"}
            onChange={() => handleAccessChange("full")}
            disabled={isUpdating}
            className="w-4 h-4"
          />
          <div>
            <div className="text-sm font-medium">Full Google Drive</div>
            <div className="text-xs text-muted-foreground">
              Search across your entire Google Drive
            </div>
          </div>
        </label>
      </div>

      {isUpdating && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="31.416"
              strokeDashoffset="31.416"
              className="animate-spin"
            />
          </svg>
          Updating...
        </div>
      )}
    </div>
  );
}
