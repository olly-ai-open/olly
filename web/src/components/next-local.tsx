"use client";

export default function NextLocal({ iso }: { iso?: string | null }) {
  if (!iso) return null;
  const d = new Date(iso);
  const label = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return <span>• Next: {label}</span>;
}

