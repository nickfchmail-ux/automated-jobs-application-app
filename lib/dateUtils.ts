/**
 * Parse a relative posted-date string (e.g. "3 days ago", "2 mo ago",
 * "1 year ago", "Just posted", "Today") into the approximate number of
 * days offset.  Returns Infinity for unparseable values so they sort last.
 */
function relativeTextToDays(value: string): number {
  const v = value.trim().toLowerCase();
  if (v === "today" || v === "just posted" || v === "just now") return 0;
  if (v === "yesterday") return 1;

  // Relative: "3 days ago", "2 mo ago", "1 year ago", "30d ago", "30+ days ago"
  const match = v.match(
    /^(\d+)\+?\s*(d|day|days|mo|month|months|yr|year|years|h|hr|hour|hours|w|week|weeks)/,
  );
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    if (unit.startsWith("h")) return 0; // hours ago → today
    if (unit === "d" || unit.startsWith("day")) return n;
    if (unit === "w" || unit.startsWith("week")) return n * 7;
    if (unit === "mo" || unit.startsWith("month")) return n * 30;
    if (unit === "yr" || unit.startsWith("year")) return n * 365;
  }

  return Infinity;
}

/**
 * Compute the actual posted date as a UTC timestamp (ms) by anchoring the
 * relative `posted_date` string against the real `scraped_date`.
 *
 * actual = scraped_date − relativeOffset(posted_date)
 *
 * When `posted_date` is missing (e.g. manual jobs), fall back to the
 * `scraped_date` so newly discovered jobs don't sort as "infinitely old"
 * (which pushed them to the bottom of fit/not-fit lists).
 *
 * Returns -Infinity only when both dates are unusable.
 */
export function computeActualPostedTimestamp(
  postedDate: string | null,
  scrapedDate: string | null,
): number {
  // If posted_date is missing, use scraped_date as the anchor (parse ISO).
  if (!postedDate) {
    if (!scrapedDate) return -Infinity;
    const [sy, sm, sd] = scrapedDate.substring(0, 10).split("-").map(Number);
    if (isNaN(sy) || isNaN(sm) || isNaN(sd)) return -Infinity;
    return Date.UTC(sy, sm - 1, sd);
  }

  // If posted_date is already an ISO date, use it directly
  if (/^\d{4}-\d{2}-\d{2}/.test(postedDate)) {
    const [y, m, d] = postedDate.substring(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  if (!scrapedDate) return -Infinity;

  const daysAgo = relativeTextToDays(postedDate);
  if (daysAgo === Infinity) return -Infinity;

  // Parse scraped_date as the anchor
  const [sy, sm, sd] = scrapedDate.substring(0, 10).split("-").map(Number);
  const scraped = Date.UTC(sy, sm - 1, sd);
  if (isNaN(scraped)) return -Infinity;

  return scraped - daysAgo * 86_400_000;
}

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
