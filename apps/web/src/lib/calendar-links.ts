export function toDayKeyInTimeZone(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const obj: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return `${obj.year}-${obj.month}-${obj.day}`;
}

function formatCompactUtcDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parseIsoDay(day: string): Date | null {
  const parts = day.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [year, month, date] = parts;
  if (!year || !month || !date) return null;
  return new Date(Date.UTC(year, month - 1, date));
}

function nextDay(day: string): string {
  const d = parseIsoDay(day);
  if (!d) return day;
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function buildGoogleCalendarTemplateUrl({
  text,
  details,
  allDayDate,
}: {
  text: string;
  details?: string;
  allDayDate?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", text);
  params.set("details", details || text);

  if (allDayDate) {
    const start = parseIsoDay(allDayDate);
    const end = parseIsoDay(nextDay(allDayDate));
    if (start && end) {
      params.set(
        "dates",
        `${formatCompactUtcDate(start)}/${formatCompactUtcDate(end)}`,
      );
    }
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
