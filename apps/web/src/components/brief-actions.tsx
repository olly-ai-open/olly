"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function BriefActions({
  briefId,
  isAdmin = false,
}: {
  briefId: string;
  readAt: string | Date | null;
  isAdmin?: boolean;
}) {
  const [thumb, setThumb] = useState<"up" | "down" | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  async function sendFeedback(v: "up" | "down") {
    setThumb(v);
    try {
      await fetch(`/api/briefs/${briefId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: v }),
      });
    } catch {}
  }

  async function deleteBrief() {
    if (
      !confirm(
        "Are you sure you want to delete this brief? This action cannot be undone.",
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/briefs/${briefId}/delete`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Navigate back to home after successful deletion
        router.push("/");
      } else {
        const error = await response.json();
        alert(`Failed to delete brief: ${error.error}`);
        setIsDeleting(false);
      }
    } catch (error) {
      console.error("Error deleting brief:", error);
      alert("Failed to delete brief. Please try again.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {isAdmin && (
        <>
          <Link
            href={`/briefs/${briefId}/debug`}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 cursor-pointer"
          >
            View Debug
          </Link>
          <button
            disabled={isDeleting}
            onClick={deleteBrief}
            className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
          >
            {isDeleting ? (
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
                Deleting...
              </>
            ) : (
              "Delete Brief"
            )}
          </button>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          aria-label="Thumbs up"
          onClick={() => sendFeedback("up")}
          className={`rounded-md border px-2 py-1 text-sm ${thumb === "up" ? "bg-accent-foreground/30 text-primary border-border" : "border-border hover:bg-border/30 cursor-pointer"}`}
        >
          👍
        </button>
        <button
          aria-label="Thumbs down"
          onClick={() => sendFeedback("down")}
          className={`rounded-md border px-2 py-1 text-sm ${thumb === "down" ? "bg-accent-foreground/30 text-primary border-border" : "border-border hover:bg-border/30 cursor-pointer"}`}
        >
          👎
        </button>
      </div>
    </div>
  );
}
