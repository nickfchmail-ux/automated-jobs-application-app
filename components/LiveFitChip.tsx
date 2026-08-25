"use client";

import { useJobState } from "@/components/JobStateProvider";

/**
 * Header fit chip — LIVE version of the server-rendered badge.
 *
 * Reads the shared job state (hydrated from the DB + kept live via Realtime
 * and the `job:state` socket event), so it transitions automatically:
 *   - fit_score null → "Matching…" (amber, pulsing)
 *   - fit true       → "Good fit" (emerald)
 *   - fit false      → "Not a fit" (red)
 */
export default function LiveFitChip({
  initialFit,
  initialFitScore,
}: {
  initialFit: boolean | null;
  initialFitScore: number | null;
}) {
  const { fit, fitScore } = useJobState();
  const score = fitScore ?? initialFitScore;
  const isFit = fit ?? initialFit;

  if (score === null || score === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
        <span className="relative flex w-1.5 h-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-amber-500" />
        </span>
        Matching…
      </span>
    );
  }
  return isFit ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
      ✓ Good Fit
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800">
      ✗ Not a Fit
    </span>
  );
}
