"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function PeopleSearch({ initialQuery }: { initialQuery?: string }) {
  const [value, setValue] = useState(initialQuery || "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Keep input in sync when URL changes (e.g., back/forward)
  useEffect(() => {
    const current = sp?.get("q") || "";
    if (current !== value) setValue(current);
    if (current === value) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // Debounced URL update
  useEffect(() => {
    setLoading(true);
    const id = setTimeout(() => {
      const params = new URLSearchParams(sp?.toString());
      if (value) params.set("q", value);
      else params.delete("q");
      const href = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      router.replace(href, { scroll: false });
    }, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, pathname]);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search people..."
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm pr-20"
      />
      {loading && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        </span>
      )}
      {value ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border px-2 py-1 text-xs"
          onClick={() => setValue("")}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
