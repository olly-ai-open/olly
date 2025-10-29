"use client";
import { useRouter } from "next/navigation";

export default function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm underline cursor-pointer"
      onClick={() => {
        // Try to go back; if it fails (no history), push fallback
        try {
          if (window.history.length > 1) router.back();
          else router.push(fallbackHref);
        } catch {
          router.push(fallbackHref);
        }
      }}
    >
      ← Back
    </button>
  );
}

