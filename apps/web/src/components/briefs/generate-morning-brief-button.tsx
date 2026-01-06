"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BriefActionPill from "@/components/briefs/brief-action-pill";

interface GenerateMorningBriefButtonProps {
  day: string;
  existingBriefId?: string | null;
  isNew?: boolean;
}

export default function GenerateMorningBriefButton({
  day,
  existingBriefId,
  isNew,
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
      <BriefActionPill
        href={`/briefs/${existingBriefId}`}
        label="View morning brief"
        isNew={isNew}
      />
    );
  }

  return (
    <BriefActionPill
      label="Generate morning brief"
      loadingLabel="Generating..."
      onClick={handleGenerate}
      disabled={isGenerating}
      isLoading={isGenerating}
    />
  );
}
