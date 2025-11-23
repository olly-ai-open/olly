"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GenerateMorningBriefButtonProps {
  day: string;
  existingBriefId?: string | null;
}

export default function GenerateMorningBriefButton({
  day,
  existingBriefId,
}: GenerateMorningBriefButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const router = useRouter();

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/briefs/morning", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ day }),
      });
      if (!response.ok) {
        console.error("Failed to generate morning brief");
        setIsGenerating(false);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      const briefId = payload?.briefId as string | undefined;
      if (briefId) {
        router.push(`/briefs/${briefId}`);
      } else {
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Error generating morning brief:", error);
      setIsGenerating(false);
    }
  };

  if (existingBriefId) {
    return (
      <button
        type="button"
        onClick={() => router.push(`/briefs/${existingBriefId}`)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent cursor-pointer"
      >
        View morning brief
      </button>
    );
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={isGenerating}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
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
        "Generate morning brief"
      )}
    </button>
  );
}
