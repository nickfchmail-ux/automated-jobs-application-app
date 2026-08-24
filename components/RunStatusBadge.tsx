"use client";

import { runStatusCopy, type RunStatusInput } from "@/lib/funnel";

const TONE_DOT: Record<string, string> = {
  neutral: "bg-zinc-400",
  active: "bg-blue-500 animate-pulse",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

/**
 * Run status badge — the plain-English state of the live search.
 * `role="status"` + `aria-live="polite"` so screen readers announce changes.
 */
export default function RunStatusBadge({ status }: { status: RunStatusInput }) {
  const { label, tone, live } = runStatusCopy(status);
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-full bg-zinc-900/90 dark:bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-100"
    >
      <span
        aria-hidden="true"
        className={`w-2 h-2 rounded-full ${TONE_DOT[tone]} ${
          live ? "motion-safe:animate-pulse" : ""
        }`}
      />
      {label}
    </span>
  );
}
