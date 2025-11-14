"use client";

interface ClientDateTimeProps {
  date: Date | string | null;
  fallback?: string;
  format?: Intl.DateTimeFormatOptions;
  prefix?: string;
}

// This component only renders on the client
export default function ClientDateTimeImpl({
  date,
  fallback = "TBD",
  format = { dateStyle: "medium", timeStyle: "short" },
  prefix = "",
}: ClientDateTimeProps) {
  if (!date) return <>{fallback}</>;

  const dateObj = typeof date === "string" ? new Date(date) : date;
  const formatted = new Intl.DateTimeFormat("en-US", format).format(dateObj);

  return (
    <span>
      {prefix}
      {formatted}
    </span>
  );
}
