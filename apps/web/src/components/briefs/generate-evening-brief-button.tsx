"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BriefActionPill from "@/components/briefs/brief-action-pill";

interface GenerateEveningBriefButtonProps {
  existingBriefId?: string | null;
  isNew?: boolean;
  briefTime?: string;
  windowHours?: number;
}

export default function GenerateEveningBriefButton({
  existingBriefId,
  isNew,
  briefTime,
  windowHours,
}: GenerateEveningBriefButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const payloadBriefTime = briefTime ?? new Date().toISOString();
      const payloadWindowHours =
        typeof windowHours === "number" && windowHours > 0 ? windowHours : 24;
      const response = await fetch("/api/briefs/evening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          briefTime: payloadBriefTime,
          windowHours: payloadWindowHours,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}) as any);
        console.error("Failed to generate end of day summary", payload);
        setError(
          payload?.message ||
            "Couldn't generate the end of day summary. Please try again.",
        );
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
      console.error("Error generating end of day summary:", error);
      setError("Couldn't generate the end of day summary. Please try again.");
      setIsGenerating(false);
    }
  };

  if (existingBriefId) {
    return (
      <BriefActionPill
        href={`/briefs/${existingBriefId}`}
        label="View end of day summary"
        isNew={isNew}
      />
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <BriefActionPill
        label="Generate end of day summary"
        loadingLabel="Generating..."
        onClick={handleGenerate}
        disabled={isGenerating}
        isLoading={isGenerating}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
