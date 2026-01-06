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
  const router = useRouter();

  const handleGenerate = async () => {
    setIsGenerating(true);
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
        console.error("Failed to generate end of day summary");
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
    <BriefActionPill
      label="Generate end of day summary"
      loadingLabel="Generating..."
      onClick={handleGenerate}
      disabled={isGenerating}
      isLoading={isGenerating}
    />
  );
}
