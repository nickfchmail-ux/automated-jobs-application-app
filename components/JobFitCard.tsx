"use client";

import { useJobState } from "@/components/JobStateProvider";
import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Live AI-fit verdict for THIS job.
 *
 * - `fit_score === null` → "Matching your resume…" (pending evaluation).
 * - scored → the verdict + reasons, with a score badge (Great / Possible /
 *   Low fit). Live via Realtime + socket `job:state`.
 */
export default function JobFitCard({
  initialFit,
  initialFitScore,
  initialFitReasons,
  initialNotFitReasons,
  initialJustification,
}: {
  initialFit: boolean | null;
  initialFitScore: number | null;
  initialFitReasons: string[] | null;
  initialNotFitReasons: string[] | null;
  initialJustification: string | null;
}) {
  // Shared live state (single socket + Realtime channel via JobStateProvider).
  const { fit, fitScore } = useJobState();
  const score = fitScore ?? initialFitScore;
  // Once a score exists, the fit verdict is a real boolean (null only happens
  // pre-evaluation, which is handled above).
  const isFit: boolean = fit ?? initialFit ?? false;

  const parsedFitReasons: string[] =
    typeof initialFitReasons === "string"
      ? JSON.parse(initialFitReasons || "[]")
      : (initialFitReasons ?? []);
  const parsedNotFitReasons: string[] =
    typeof initialNotFitReasons === "string"
      ? JSON.parse(initialNotFitReasons || "[]")
      : (initialNotFitReasons ?? []);

  // Pending evaluation
  if (score === null || score === undefined) {
    return (
      <section
        className="rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-6"
        aria-label="Fit analysis pending"
      >
        <div className="flex items-center gap-3">
          <svg
            className="w-5 h-5 text-blue-500 animate-spin motion-reduce:hidden"
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
          <div>
            <h2 className="text-sm font-semibold text-blue-700 dark:text-blue-300">
              This job hasn&apos;t been scored yet.
            </h2>
            <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">
              Go to the Search page and click{" "}
              <span className="font-medium">Match</span> for the search key
              that found this job to see how well it fits your profile.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const reasons = isFit ? parsedFitReasons : parsedNotFitReasons;

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-2xl border p-6 ${
        isFit
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50"
          : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50"
      }`}
      aria-label={isFit ? "Why it's a good fit" : "Why it doesn't fit"}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {isFit ? "Why it&apos;s a good fit" : "Why it doesn&apos;t fit"}
        </h2>
        <ScorePill score={score} isFit={isFit} />
      </div>

      {initialJustification && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed mb-4">
          {initialJustification}
        </p>
      )}

      {reasons.length > 0 ? (
        <ul className="space-y-3">
          {reasons.map((reason, i) => (
            <li
              key={i}
              className="flex gap-3 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <span
                className={`mt-0.5 shrink-0 text-base leading-none ${
                  isFit ? "text-emerald-500" : "text-red-400"
                }`}
              >
                {isFit ? "✓" : "✗"}
              </span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          {isFit
            ? "A strong match for your profile."
            : "This role isn't a strong match for your current profile."}
        </p>
      )}
    </motion.section>
  );
}

function ScorePill({
  score,
  isFit,
}: {
  score: number;
  isFit: boolean;
}): ReactNode {
  const bucket =
    score >= 75
      ? {
          label: "Great fit",
          cls: "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300",
        }
      : score >= 50
        ? {
            label: "Possible fit",
            cls: "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300",
          }
        : {
            label: "Low fit",
            cls: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300",
          };

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${bucket.cls} ${isFit ? "" : "opacity-90"}`}
    >
      <span className="font-data tabular-nums">{score}/100</span>
      <span className="opacity-70">·</span>
      {bucket.label}
    </span>
  );
}
