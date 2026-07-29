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
  // Optimistic handoff: once the API returns a brief id, show "View Brief"
  // immediately instead of waiting for router.refresh() to remount the card
  // (that soft refresh often never clears the spinner in the desktop app).
  const [completedBriefId, setCompletedBriefId] = useState<string | null>(null);
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
        const payload = await response.json().catch(() => ({}) as any);
        const briefId = payload?.brief?.id as string | undefined;
        if (briefId) {
          setCompletedBriefId(briefId);
          setIsGenerating(false);
          // Best-effort: refresh so Key Context bullets appear under the card.
          // Do not depend on this to clear the spinner.
          router.refresh();
          return;
        }
        setError("Brief was generated but no id was returned. Refresh the page.");
        setIsGenerating(false);
        router.refresh();
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

  if (completedBriefId) {
    return (
      <BriefActionPill
        href={`/briefs/${completedBriefId}`}
        label="View Brief"
        isNew
      />
    );
  }

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
