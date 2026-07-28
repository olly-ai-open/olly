"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BriefActionPill from "@/components/briefs/brief-action-pill";

interface GenerateBriefButtonProps {
  eventId: string;
}

export default function GenerateBriefButton({
  eventId,
}: GenerateBriefButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/briefs/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId,
          force: true,
        }),
      });

      if (response.ok) {
        // Stay on the dashboard: refresh so the meeting card swaps to
        // "View Brief" and shows the Key Context summary inline.
        router.refresh();
        // Keep the spinner up briefly so the refresh can remount the card
        // before we clear local loading state (the Generate button unmounts
        // once the server re-render sees the new brief).
        return;
      }

      const payload = await response.json().catch(() => ({}) as any);
      console.error("Failed to generate brief:", response.status, payload);
      setError(
        payload?.message || "Couldn't generate the brief. Please try again.",
      );
      setIsGenerating(false);
    } catch (error) {
      console.error("Error generating brief:", error);
      setError("Couldn't generate the brief. Please try again.");
      setIsGenerating(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <BriefActionPill
        label="Generate brief"
        loadingLabel="Generating..."
        onClick={handleGenerate}
        disabled={isGenerating}
        isLoading={isGenerating}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
