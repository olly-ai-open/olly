"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type AttendeeEntry = { label: string; href?: string };

export function AttendeeList({
  primary,
  overflow,
}: {
  primary: AttendeeEntry[];
  overflow: AttendeeEntry[];
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!primary.length) return null;

  return (
    <div className="text-sm text-muted-foreground">
      with:{" "}
      {primary.map((person, idx) => (
        <span key={person.label + idx}>
          {idx > 0 ? ", " : ""}
          {person.href ? (
            <Link
              href={person.href}
              className="text-primary underline underline-offset-4 hover:underline"
            >
              {person.label}
            </Link>
          ) : (
            person.label
          )}
        </span>
      ))}
      {overflow.length ? (
        <span className="relative ml-2 inline-block" ref={popoverRef}>
          <button
            type="button"
            className="cursor-pointer text-xs font-semibold text-primary underline underline-offset-4 focus:outline-none"
            onClick={() => setOpen((prev) => !prev)}
          >
            +{overflow.length} more
          </button>
          {open ? (
            <div className="absolute left-0 z-20 mt-1 w-64 rounded-xl border border-border/70 bg-card p-3 text-xs text-foreground shadow-card">
              <div className="space-y-1">
                {overflow.map((person, idx) => (
                  <div key={person.label + idx}>
                    {person.href ? (
                      <Link
                        href={person.href}
                        className="text-primary underline underline-offset-4 hover:underline"
                      >
                        {person.label}
                      </Link>
                    ) : (
                      person.label
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
