"use client";

import { evaluationBatchCopy, batchProgress } from "@/lib/funnel";
import type { EvaluationRunRow } from "@/types/api";
import { useSelector } from "react-redux";
import type { RootState } from "@/state/global/store";

/**
 * The "Evaluating…" panel. Each row is one keyword batch from the AI
 * evaluator microservice — the user sees which keyword is being matched
 * against their resume and how far through it is, in plain language.
 *
 * Rows are grouped under a quiet header; no jargon. Rows fade in as batches
 * land (no motion under prefers-reduced-motion).
 */
export default function EvaluationProgress() {
  const evaluationRuns = useSelector(
    (s: RootState) => s.run.evaluationRuns,
  );
  const evaluationStatus = useSelector(
    (s: RootState) => s.run.evaluationStatus,
  );

  if (evaluationRuns.length === 0) return null;

  const active = evaluationRuns.filter(
    (r) => r.status === "evaluating" || r.status === "queued",
  );
  const done = evaluationRuns.filter(
    (r) => r.status === "completed" || r.status === "failed",
  );

  const totalJobs = evaluationRuns.reduce(
    (n, r) => n + (r.total_jobs ?? 0),
    0,
  );
  const processedJobs = evaluationRuns.reduce(
    (n, r) => n + (r.processed_jobs ?? 0),
    0,
  );
  const failedJobs = evaluationRuns.reduce(
    (n, r) => n + (r.failed_jobs ?? 0),
    0,
  );

  const rows = [...active, ...done];

  return (
    <section
      aria-label="AI evaluation progress"
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="relative flex w-2.5 h-2.5" aria-hidden="true">
            {evaluationStatus === "evaluating" && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 motion-safe:animate-ping" />
            )}
            <span
              className={`relative inline-flex rounded-full w-2.5 h-2.5 ${
                evaluationStatus === "completed"
                  ? "bg-emerald-500"
                  : evaluationStatus === "failed"
                    ? "bg-red-500"
                    : "bg-blue-500"
              }`}
            />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Matching jobs to your resume
            </h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {processedJobs} of {totalJobs} jobs matched
              {failedJobs > 0 ? ` · ${failedJobs} couldn't be matched` : ""}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-zinc-400 dark:text-zinc-500">
          {active.length > 0 ? `${active.length} in progress` : "All done"}
        </span>
      </div>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((run: EvaluationRunRow) => {
          const copy = evaluationBatchCopy(run.status);
          const progress = batchProgress(run);
          return (
            <li
              key={run.id}
              className="job-enter px-5 py-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                    &ldquo;{run.keyword}&rdquo;
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {run.processed_jobs ?? 0} of {run.total_jobs ?? 0} jobs
                    {run.last_error ? ` · ${run.last_error}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${
                    copy.tone === "success"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : copy.tone === "error"
                        ? "text-red-600 dark:text-red-400"
                        : copy.tone === "active"
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {copy.label}
                </span>
              </div>
              <div
                className="mt-2 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
                aria-hidden="true"
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${
                    copy.tone === "success"
                      ? "bg-emerald-500"
                      : copy.tone === "error"
                        ? "bg-red-400"
                        : "bg-blue-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
