import { getResumeInfo } from "@/app/actions/resume";
import ScrapePanel from "@/components/ScrapePanel";

/**
 * Server component that loads whether the user has uploaded a resume, then
 * renders the Search panel. Kept in its own file so `page.tsx` has zero
 * top-level awaits — the page shell paints immediately and this streams in.
 */
export default async function ScrapePanelWithResume() {
  let hasResume = false;
  try {
    const resumeInfo = await getResumeInfo();
    hasResume = resumeInfo.ok && !!resumeInfo.fileName;
  } catch (err) {
    console.error("[ScrapePanelWithResume] resume info error:", err);
  }
  return <ScrapePanel hasResume={hasResume} />;
}
