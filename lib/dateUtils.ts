/**
 * If the value looks like an ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:...), convert
 * it to a human-friendly relative string ("Today", "Yesterday", "3 days ago").
 * Otherwise return the value as-is (e.g. "3d ago" scraped strings).
 */
export function formatDate(value: string | null): string | null {
  if (!value) return null;

  const isoPattern = /^\d{4}-\d{2}-\d{2}/;
  if (!isoPattern.test(value)) return value; // already human-readable

  // Parse as LOCAL date to avoid UTC-midnight timezone off-by-one.
  // new Date("2026-03-03") is UTC midnight which shifts the day in non-UTC zones.
  const [year, month, day] = value.substring(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (isNaN(date.getTime())) return value;

  const hkToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
  }).format(new Date());
  const [ty, tm, td] = hkToday.split("-").map(Number);
  const today = new Date(Date.UTC(ty, tm - 1, td));

  const days = Math.round(
    (today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1) return `${days} days ago`;
  return value; // future date — show raw
}
