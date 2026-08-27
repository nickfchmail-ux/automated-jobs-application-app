import { getResumeInfo } from "@/app/actions/resume";
import { getScraperApiAvailability } from "@/app/actions/scraperApi";
import ScrapePanel from "@/components/ScrapePanel";
import { getUserId } from "@/lib/auth";
import { getLimitsForProfile, getProfile } from "@/lib/entitlements";

/**
 * Server component that loads whether the user has uploaded a resume AND their
 * plan's search capability (pages + Indeed), then renders the Search panel.
 * Kept in its own file so `page.tsx` has zero top-level awaits — the page
 * shell paints immediately and this streams in.
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
      getResumeInfo(),
      getUserId(),
      getScraperApiAvailability(),
    ]);
    hasResume = resumeInfo.ok && !!resumeInfo.fileName;
    indeedUnavailable = !sa.available;
    if (userId) {
      const profile = await getProfile(userId);
      const limits = getLimitsForProfile(profile);
      maxPages = limits.search.maxPages;
      indeedEnabled = limits.search.indeedEnabled;
      maxResultsPerBoard = Number.isFinite(limits.search.maxResultsPerBoard)
        ? limits.search.maxResultsPerBoard
        : undefined;
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
