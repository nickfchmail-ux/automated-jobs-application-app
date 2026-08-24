"use client";

import { resumeStatusCopy } from "@/lib/funnel";
import type { ResumeStatus } from "@/types/api";

const TONE_STYLES: Record<string, string> = {
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  active: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  success:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  error: "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400",
};

/**
 * Compact badge showing the tailored-resume state on a job card.
 * - completed → links to the generated HTML/PDF (auto-generated on match)
 * - building → live "Tailoring your resume…"
 * - failed / none → muted (user can open the detail page to retry)
 */
export default function ResumeStatusBadge({
  status,
  resumeUrl,
  resumePdfUrl,
}: {
  status: ResumeStatus | null | undefined;
  resumeUrl?: string | null;
  resumePdfUrl?: string | null;
}) {
  const copy = resumeStatusCopy((status as ResumeStatus) ?? "none");
  const done = status === "completed" && (resumeUrl || resumePdfUrl);

  const inner = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border border-transparent ${TONE_STYLES[copy.tone]}`}
    >
      {done ? (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ) : copy.tone === "active" ? (
        <svg
          className="w-3 h-3 animate-spin motion-reduce:hidden"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      )}
      {done ? "Resume ready" : copy.label}
    </span>
  );

  // Only the completed state links out (HTML preferred, PDF fallback)
  if (done) {
    return (
      <a
        href={resumeUrl || resumePdfUrl || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0"
        title="Open your tailored resume"
      >
        {inner}
      </a>
    );
  }

  return <span className="shrink-0">{inner}</span>;
}
