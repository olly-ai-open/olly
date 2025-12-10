"use client";

export default function NextLocal({
  iso,
  timeZone,
}: {
  iso?: string | null;
  timeZone?: string | null;
}) {
  if (!iso) return null;
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  };
  const label = new Intl.DateTimeFormat("en-US", opts).format(d);
  return <span>{label}</span>;
}
