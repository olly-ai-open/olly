"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GenerateBriefButtonProps {
  eventId: string;
}

export default function GenerateBriefButton({
  eventId,
}: GenerateBriefButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const router = useRouter();

  const handleGenerate = async () => {
    setIsGenerating(true);

    try {
      const response = await fetch("/api/briefs/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId,
          redirect: "1",
          force: true,
        }),
      });

      if (response.ok) {
        // Refresh the page to show the updated brief status
        router.refresh();
      } else {
        console.error("Failed to generate brief");
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Error generating brief:", error);
      setIsGenerating(false);
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={isGenerating}
      className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
    >
      {isGenerating ? (
        <>
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
          Generating...
        </>
      ) : (
        "Generate brief"
      )}
    </button>
  );
}
