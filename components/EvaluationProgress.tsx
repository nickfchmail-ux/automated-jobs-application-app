"use client";

import { evaluationBatchCopy } from "@/lib/funnel";
import type { RootState } from "@/state/global/store";
import type { EvaluationRunRow } from "@/types/api";
import { AnimatePresence, motion } from "motion/react";
import { useSelector } from "react-redux";

/**
 * The "Evaluating…" panel. Each row is one keyword batch from the AI
 * evaluator microservice — the user sees which keyword is being matched
 * against their resume and how far through it is, in plain language.
 *
 * Only the batch for the CURRENT match is shown: the socket delivers the
 * user's ACCOUNT-WIDE batches (all keys, all runs), but the panel must show
 * just the key currently being matched — and crucially, when a NEW match
 * starts it must NOT show stale batches from previous matches. So we scope
 * by BOTH the active search key (`activeKey`) and the match's target run
 * (`runId`). When either is omitted, the other filter still applies.
 *
 * Rows are grouped under a quiet header; no jargon. Rows fade in as batches
 * land (no motion under prefers-reduced-motion).
 */
export default function EvaluationProgress({
  activeKey,
  runId,
}: {
  activeKey?: string;
  runId?: string | null;
}) {
  const allRuns = useSelector((s: RootState) => s.run.evaluationRuns);
  const evaluationStatus = useSelector(
    (s: RootState) => s.run.evaluationStatus,
  );
  const jobStream = useSelector((s: RootState) => s.run.jobStream);

  // Scope to the active search key (normalize like the evaluator does) AND to
  // the current match's run — so a new match never shows the previous match's
  // completed batch (the account-wide socket list keeps old batches around).
  const normalizedKey = activeKey?.trim().toLowerCase().replace(/\s+/g, "_");
  const evaluationRuns = allRuns.filter((r) => {
    if (normalizedKey) {
      const key = String(r.keyword ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
      if (!key.startsWith(normalizedKey)) return false;
    }
    if (runId) {
      // Only batches belonging to the current match's run. Batches without a
      // pipeline_run_id (e.g. socket fallback) are kept only when the key
      // matched — the run-scoped poller replaces them with correct rows.
      if (r.pipeline_run_id && r.pipeline_run_id !== runId) return false;
    }
    return true;
  });

  // A match is in-flight but no batches have landed yet (the table was just
  // cleared for a NEW match and the evaluator hasn't created rows/queued the
  // Service Bus messages). Show a clear "starting…" panel instead of nothing
  // so the user always knows evaluation is running.
  if (evaluationRuns.length === 0) {
    if (evaluationStatus === "evaluating" || evaluationStatus === "queued") {
      return (
        <section
          aria-label="AI evaluation progress"
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
            <span className="relative flex w-2.5 h-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-blue-500" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Matching jobs to your resume
              </h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Starting your match — preparing the jobs to score…
              </p>
            </div>
          </div>
          <div className="px-5 py-6 flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
            <svg
              className="w-4 h-4 animate-spin motion-reduce:hidden text-blue-500"
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
            <span>Getting the evaluator ready…</span>
          </div>
        </section>
      );
    }
    return null;
  }

  const active = evaluationRuns.filter(
    (r) => r.status === "evaluating" || r.status === "queued",
  );
  const done = evaluationRuns.filter(
    (r) => r.status === "completed" || r.status === "failed",
  );

  const totalJobs = evaluationRuns.reduce((n, r) => n + (r.total_jobs ?? 0), 0);
  const processedJobs = evaluationRuns.reduce(
    (n, r) => n + (r.processed_jobs ?? 0),
    0,
  );
  const failedJobs = evaluationRuns.reduce(
    (n, r) => n + (r.failed_jobs ?? 0),
    0,
  );

  // ── Fit / not-fit / remaining ────────────────────────────────────────
  // Use the Redux `evaluationRuns.fit_jobs`/`not_fit_jobs` as the PRIMARY
  // source — EvaluationStep now refreshes these from the evaluator's status
  // endpoint (account-wide, authoritative) when evaluation completes, so they
  // are correct. Fall back to deriving from the run-scoped `jobStream` (for
  // run-scoped evaluations) when no socket/status counts are available.
  const scoredJobs = jobStream.filter(
    (j) => j.fit_score !== null && j.fit_score !== undefined,
  );
  const fitJobsFromStream = scoredJobs.filter((j) => j.fit === true).length;
  const notFitJobsFromStream = scoredJobs.filter((j) => j.fit === false).length;

  const statusFitJobs = evaluationRuns.reduce(
    (n, r) => n + (r.fit_jobs ?? 0),
    0,
  );
  const statusNotFitJobs = evaluationRuns.reduce(
    (n, r) => n + (r.not_fit_jobs ?? 0),
    0,
  );
  const remainingJobs = evaluationRuns.reduce(
    (n, r) =>
      n +
      (r.remaining_jobs ??
        Math.max(
          0,
          (r.total_jobs ?? 0) - (r.processed_jobs ?? 0) - (r.failed_jobs ?? 0),
        )),
    0,
  );
  // Prefer the authoritative account-wide status/socket counts whenever they
  // carry real data. Previously we only used them at a terminal state, which
  // kept fit/not-fit at 0 DURING evaluation for account-wide (search-key)
  // evaluations — the scored jobs live under a different run than the active
  // Redux run, so the run-scoped `jobStream` stays empty even though jobs are
  // being scored (processedJobs increments but fit/not-fit stayed 0).
  // Only fall back to the run-scoped jobStream when the status counts are all
  // zero (no socket/status data has landed yet).
  const hasStatusCounts =
    statusFitJobs > 0 || statusNotFitJobs > 0 || remainingJobs > 0;
  const fitJobs = hasStatusCounts ? statusFitJobs : fitJobsFromStream;
  const notFitJobs = hasStatusCounts ? statusNotFitJobs : notFitJobsFromStream;

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

      {/* Live fit / not-fit / remaining summary strip */}
      <div className="px-5 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <span className="text-emerald-600 dark:text-emerald-400">
          <strong className="font-semibold tabular-nums">{fitJobs}</strong> fit
        </span>
        <span className="text-rose-600 dark:text-rose-400">
          <strong className="font-semibold tabular-nums">{notFitJobs}</strong>{" "}
          not a fit
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          <strong className="font-semibold tabular-nums">
            {remainingJobs}
          </strong>{" "}
          remaining
        </span>
        <span className="text-zinc-400 dark:text-zinc-500 ml-auto">
          {processedJobs}/{totalJobs} scored
        </span>
      </div>

      {/* Per-keyword table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500">
              <th className="text-left font-medium px-5 py-2">Keyword</th>
              <th className="text-right font-medium px-3 py-2">Status</th>
              <th className="text-right font-medium px-3 py-2">Fit</th>
              <th className="text-right font-medium px-3 py-2">Not fit</th>
              <th className="text-right font-medium px-3 py-2">Remaining</th>
              <th className="text-right font-medium px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <AnimatePresence initial={false}>
              {rows.map((run: EvaluationRunRow) => {
                const copy = evaluationBatchCopy(run.status);
                const fit = run.fit_jobs ?? 0;
                const notFit = run.not_fit_jobs ?? 0;
                const remaining =
                  run.remaining_jobs ??
                  Math.max(
                    0,
                    (run.total_jobs ?? 0) -
                      (run.processed_jobs ?? 0) -
                      (run.failed_jobs ?? 0),
                  );
                return (
                  <motion.tr
                    key={run.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    role="status"
                    aria-live="polite"
                  >
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[12rem]">
                        &ldquo;{run.keyword}&rdquo;
                      </p>
                      {run.last_error && (
                        <p className="text-[11px] text-red-600 dark:text-red-400">
                          {run.last_error}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          copy.tone === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : copy.tone === "error"
                              ? "text-red-600 dark:text-red-400"
                              : copy.tone === "active"
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-zinc-500 dark:text-zinc-400"
                        }`}
                      >
                        {copy.tone === "active" && (
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
                        )}
                        {copy.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                      {fit}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400 font-semibold">
                      {notFit}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {remaining}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                      {run.total_jobs ?? 0}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </section>
  );
}
