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
        const responseText = await response.text();
        let errorData: Record<string, unknown> = {};
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { rawResponse: responseText };
        }
        console.error("Failed to generate brief:", response.status, errorData);
        setIsGenerating(false);
      }
    } catch (error) {
      console.error("Error generating brief:", error);
      setIsGenerating(false);
    }
  };

  return (
    <BriefActionPill
      label="Generate brief"
      loadingLabel="Generating..."
      onClick={handleGenerate}
      disabled={isGenerating}
      isLoading={isGenerating}
    />
  );
}
