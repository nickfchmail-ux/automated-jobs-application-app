import { getResumeInfo } from "@/app/actions/resume";
import { getScraperApiAvailability } from "@/app/actions/scraperApi";
import ScrapePanel from "@/components/ScrapePanel";
import { getUserId } from "@/lib/auth";
import { getLimitsForProfile, getProfile } from "@/lib/entitlements";

/** Timeout for the resume/entitlement bootstrap queries (ms).
 *
 * Supabase can be degraded/slow (this is the #1 cause of the "search page
 * stuck on Loading…" hang). If the bootstrap queries don't resolve in this
 * window, we render the Search panel IMMEDIATELY with safe defaults rather
 * than blocking the panel on slow reads. The backend enforces plan limits
 * authoritatively, so defaults (maxPages=1, no Indeed, hasResume=false) are
 * safe — the user can still run a search and the real limits apply server-side.
 */
const BOOTSTRAP_TIMEOUT_MS = 3500;

/** Race a promise against a timeout — resolve `fallback` if it's too slow. */
async function withTimeout<T>(
  p: Promise<T>,
  fallback: T,
  ms = BOOTSTRAP_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Server component that loads whether the user has uploaded a resume AND their
 * plan's search capability (pages + Indeed), then renders the Search panel.
 * Kept in its own file so `page.tsx` has zero top-level awaits — the page
 * shell paints immediately and this streams in.
 *
 * The bootstrap queries are raced against a short timeout so a slow/degraded
 * Supabase can never leave the Search panel stuck on its Suspense fallback
 * ("Loading…"). On timeout we render with safe defaults; the backend still
 * enforces plan limits and quota authoritatively on the scrape trigger.
 */
export default async function ScrapePanelWithResume() {
  let hasResume = false;
  let maxPages = 1;
  let indeedEnabled = true;
  let maxResultsPerBoard: number | undefined;
  // True when every ScraperAPI key is exhausted today → hide Indeed entirely.
  let indeedUnavailable = false;
  try {
    const [resumeInfo, userId, sa] = await Promise.all([
      withTimeout(getResumeInfo(), { ok: false, error: "timeout" }),
      withTimeout(getUserId(), null),
      withTimeout(getScraperApiAvailability(), {
        available: true,
        exhausted: false,
      }),
    ]);
    hasResume = resumeInfo.ok && !!resumeInfo.fileName;
    indeedUnavailable = !sa.available;
    if (userId) {
      const profile = await withTimeout(
        getProfile(userId),
        null,
      );
      if (profile) {
        const limits = getLimitsForProfile(profile);
        maxPages = limits.search.maxPages;
        indeedEnabled = limits.search.indeedEnabled;
        maxResultsPerBoard = Number.isFinite(limits.search.maxResultsPerBoard)
          ? limits.search.maxResultsPerBoard
          : undefined;
      }
    }
  } catch (err) {
    console.error("[ScrapePanelWithResume] resume info error:", err);
  }
  return (
    <ScrapePanel
      hasResume={hasResume}
      maxPages={maxPages}
      indeedEnabled={indeedEnabled}
      indeedUnavailable={indeedUnavailable}
      maxResultsPerBoard={maxResultsPerBoard}
    />
  );
}
