"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RemoveFolderButtonProps {
  folderId: string;
}

export default function RemoveFolderButton({
  folderId,
}: RemoveFolderButtonProps) {
  const [isRemoving, setIsRemoving] = useState(false);
  const router = useRouter();

  const handleRemove = async () => {
    if (!confirm("Remove access to this folder?")) {
      return;
    }

    setIsRemoving(true);
    try {
      const response = await fetch("/api/drive/folders", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ folderId }),
      });

      if (response.ok) {
        router.refresh(); // Refresh to update the folder list
      } else {
        console.error("Failed to remove folder");
      }
    } catch (error) {
      console.error("Error removing folder:", error);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <button
      onClick={handleRemove}
      disabled={isRemoving}
      className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
    >
      {isRemoving ? "Removing..." : "Remove"}
    </button>
  );
}
