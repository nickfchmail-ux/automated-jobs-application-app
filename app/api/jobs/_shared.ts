import { computeActualPostedTimestamp } from "@/lib/dateUtils";
import { NextRequest, NextResponse } from "next/server";

const PAGE_SIZE = 12;

function detectSourceName(url: string): string {
  if (url.includes("jobsdb.com")) return "JobsDB";
  if (url.includes("indeed.com")) return "Indeed";
  if (url.includes("ctgoodjobs.hk")) return "CTgoodjobs";
  if (url.includes("offertoday.com")) return "OfferToday";
  if (url.includes("glassdoor.com")) return "Glassdoor";
  return "Other";
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Given the full unfiltered job list and the request, applies server-side
 * filters (source, search_key, applied), sorts by actual posted date,
 * paginates, and returns the JSON response including filter options derived
 * from the full (unfiltered) set.
 */
export function paginateAndFilter(
  allJobs: Record<string, unknown>[],
  req: NextRequest,
): NextResponse {
  try {
    const cursor = parseInt(req.nextUrl.searchParams.get("cursor") ?? "0", 10);
    const source = req.nextUrl.searchParams.get("source"); // e.g. "JobsDB"
    const searchKey = req.nextUrl.searchParams.get("search_key"); // e.g. "Software Engineer"
    const applied = req.nextUrl.searchParams.get("applied"); // "true" | "false"

    // Derive filter options from the full unfiltered set
    const sources = [
      ...new Set(allJobs.map((j) => detectSourceName(j.url as string))),
    ].sort();
    const searchKeys = [
      ...new Set(
        allJobs.map((j) => formatKey((j.search_key as string) ?? "Unknown")),
      ),
    ].sort();

    // Build a compact breakdown so the client can compute filtered totals
    const breakdownMap = new Map<string, number>();
    for (const j of allJobs) {
      const key = `${detectSourceName(j.url as string)}\0${formatKey((j.search_key as string) ?? "Unknown")}\0${j.applied === true}`;
      breakdownMap.set(key, (breakdownMap.get(key) ?? 0) + 1);
    }
    const filterBreakdown = [...breakdownMap.entries()].map(([k, count]) => {
      const [source, searchKey, applied] = k.split("\0");
      return { source, searchKey, applied: applied === "true", count };
    });

    // Apply filters
    let filtered = allJobs;

    if (source && source !== "All") {
      filtered = filtered.filter(
        (j) => detectSourceName(j.url as string) === source,
      );
    }

    if (searchKey && searchKey !== "All") {
      filtered = filtered.filter(
        (j) => formatKey((j.search_key as string) ?? "Unknown") === searchKey,
      );
    }

    if (applied === "true") {
      filtered = filtered.filter((j) => j.applied === true);
    } else if (applied === "false") {
      filtered = filtered.filter((j) => !j.applied);
    }

    // Sort by actual posted date (newest first)
    const sorted = filtered.sort(
      (a, b) =>
        computeActualPostedTimestamp(
          b.posted_date as string | null,
          b.scraped_date as string | null,
        ) -
        computeActualPostedTimestamp(
          a.posted_date as string | null,
          a.scraped_date as string | null,
        ),
    );

    const page = sorted.slice(cursor, cursor + PAGE_SIZE);
    const nextCursor =
      cursor + PAGE_SIZE < sorted.length ? cursor + PAGE_SIZE : null;

    return NextResponse.json({
      jobs: page,
      nextCursor,
      total: sorted.length,
      filterOptions: { sources, searchKeys },
      filterBreakdown,
    });
  } catch (err) {
    console.error("[paginateAndFilter] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error while processing jobs" },
      { status: 500 },
    );
  }
}
