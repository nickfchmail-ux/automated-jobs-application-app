"use client";

import { startEvaluationAction } from "@/app/actions/evaluate";
import EvaluationProgress from "@/components/EvaluationProgress";
import { runEvaluating } from "@/state/global/slice/runSlice";
import type { RootState } from "@/state/global/store";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useDispatch, useSelector } from "react-redux";

/**
 * Step 2 of the two-step dashboard flow: "Match jobs to your resume".
 *
 * Kept as a distinct stage from the scrape panel (Step 1). It only becomes
 * actionable once a scrape has fully finished (`phase === "completed"`) and
 * evaluation hasn't run yet for that run (`evaluationStatus === "none"`).
 *
 * Triggering it calls the AI evaluator microservice — the scrape and the
 * evaluation stay as two separate, deliberately-decoupled backend services,
 * and this UI makes that separation visible to the user.
 */
export default function EvaluationStep() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { phase, runId, counts, keyword, evaluationStatus } = useSelector(
    (s: RootState) => s.run,
  );
  const [, startTransition] = useTransition();
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalRequesting, setEvalRequesting] = useState(false);

  // Step 2 is only reachable after Step 1 (scrape) has fully finished.
  // Evaluation can be started when it hasn't run yet ("none") OR when it
  // previously failed (so the user can retry). It's blocked while queued /
  // evaluating and once completed.
  const canEvaluate =
    !!runId &&
    phase === "completed" &&
    (evaluationStatus === "none" || evaluationStatus === "failed");

  const evaluationActive =
    evaluationStatus === "queued" || evaluationStatus === "evaluating";

  function handleEvaluate() {
    if (!runId) return;
    setEvalError(null);
    setEvalRequesting(true);
    dispatch(runEvaluating());

    startTransition(async () => {
      const result = await startEvaluationAction(runId!, {
        searchKey: keyword ?? undefined,
      });
      setEvalRequesting(false);
      if (!result.ok) {
        if (/resume/i.test(result.error)) {
          setEvalError(
            "You need to upload your resume before we can match jobs to it.",
          );
        } else {
          setEvalError(
            "We couldn't start matching your jobs. Please try again in a moment.",
          );
        }
        return;
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Step 2 trigger — a distinct card from the scrape panel */}
      <section
        id="match-jobs"
        aria-label="Match jobs to your resume"
        className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 shadow-sm overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-indigo-100 dark:border-indigo-800/60 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-indigo-600 dark:text-indigo-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Match jobs to your resume
            </h2>
            <p className="text-xs text-indigo-600 dark:text-indigo-300">
              Grouped by keyword, scored against your resume, and ranked by fit.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-indigo-700 dark:text-indigo-300">
            {canEvaluate
              ? `${counts.unique || 0} saved jobs from your last search are ready to match.`
              : phase === "completed"
                ? "This run has already been matched."
                : "Run a search first — matching becomes available once it finishes."}
          </p>
          <button
            onClick={handleEvaluate}
            disabled={!canEvaluate || evalRequesting}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 shadow-sm hover:shadow transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {evalRequesting || evaluationActive ? (
              <>
                <svg
                  className="w-3.5 h-3.5 animate-spin motion-reduce:hidden"
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
                {evaluationActive ? "Matching…" : "Starting…"}
              </>
            ) : (
              <>Match jobs →</>
            )}
          </button>
        </div>
      </section>

      {evalError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {evalError}
        </div>
      )}

      {/* Per-keyword batch progress while evaluating */}
      {(evaluationStatus === "queued" ||
        evaluationStatus === "evaluating" ||
        evaluationStatus === "completed" ||
        evaluationStatus === "failed") && <EvaluationProgress />}

      {/* Done state — only after evaluation has completed */}
      {phase === "completed" &&
        (evaluationStatus === "completed" ||
          evaluationStatus === "failed" ||
          evaluationStatus === "none") && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </span>
              <p className="text-sm text-emerald-800 dark:text-emerald-300">
                Done — {counts.fit || 0} great fit
                {(counts.fit || 0) !== 1 ? "s" : ""} ready to review.
              </p>
            </div>
            <button
              onClick={() => router.push("/fit")}
              className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
            >
              View great fits →
            </button>
          </div>
        )}
    </div>
  );
}
