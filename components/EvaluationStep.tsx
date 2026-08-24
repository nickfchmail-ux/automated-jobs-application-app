"use client";

import {
  getEvaluationRunsAction,
  getEvaluationStatusAction,
  startEvaluationAction,
} from "@/app/actions/evaluate";
import EvaluationProgress from "@/components/EvaluationProgress";
import { useSearchKeys } from "@/hooks/useSearchKeys";
import {
  evaluationRunsUpdated,
  runEvaluating,
} from "@/state/global/slice/runSlice";
import type { RootState } from "@/state/global/store";
import type { EvaluationRunRow } from "@/types/api";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useDispatch, useSelector } from "react-redux";

/** Normalize a keyword to the stored search_key form ("Web Developer" → "web_developer"). */
function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * "Match jobs to your resume" — the post-scrape evaluation control.
 *
 * Lists EVERY search key that still has unevaluated posts (account-wide, not
 * just the current run), lets the user pick one via a scrollable dropdown
 * (defaulting to the current search's key), and runs the AI evaluator against
 * it. After triggering, it shows live progress AND a clear "matching started"
 * confirmation, then a "View matches" link once done — so the user always
 * knows the evaluation actually ran.
 *
 * Progress is kept live by BOTH Supabase Realtime AND a fallback poller (the
 * evaluator REST status + a direct Supabase read) so the "Matching…" state
 * never freezes even if Realtime isn't delivering.
 */
export default function EvaluationStep() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { phase, runId, keyword, counts, evaluationStatus } = useSelector(
    (s: RootState) => s.run,
  );
  const [, startTransition] = useTransition();

  // ALWAYS load the account-wide search keys with unevaluated posts — the
  // match control must be visible whenever there's anything left to match,
  // even after a page reload (when Redux has no active run). `runId` is only
  // used to highlight the current search's key.
  const { keys, reload } = useSearchKeys(runId, true, evaluationStatus);
  const [selected, setSelected] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalRequesting, setEvalRequesting] = useState(false);
  const [justStarted, setJustStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const defaultKey = useMemo(
    () => (keyword ? normalizeKey(keyword) : ""),
    [keyword],
  );
  const evaluationActive =
    evaluationStatus === "queued" || evaluationStatus === "evaluating";

  // Default the selection to the current search's key (or the first key with
  // unevaluated posts). Re-resolve when the key list changes.
  useEffect(() => {
    setSelected((prev) => {
      if (prev && keys.some((k) => k.searchKey === prev)) return prev;
      const current = keys.find((k) => k.searchKey === defaultKey);
      return (current ?? keys[0])?.searchKey ?? "";
    });
  }, [keys, defaultKey]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!dropdownOpen) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [dropdownOpen]);

  const selectedKey = keys.find((k) => k.searchKey === selected);
  const isCurrentRunKey = selected === defaultKey && !!defaultKey;

  // ── Live progress poller (fallback to Realtime) ────────────────────
  // While an evaluation is active, poll the evaluator's REST status + read
  // `evaluation_runs` directly so the UI never freezes on "0 of 0 jobs"
  // even if Supabase Realtime isn't delivering the table's changes.
  const activeRunId = runId ?? selectedKey?.runId ?? null;
  useEffect(() => {
    if (!evaluationActive || !activeRunId) return;
    const id = activeRunId; // narrow to string for the async closure
    let disposed = false;

    async function poll() {
      if (disposed) return;
      // REST status from the evaluator (per-batch progress).
      const status = await getEvaluationStatusAction(id);
      if (!disposed && status.ok && status.data.batches?.length) {
        dispatch(
          evaluationRunsUpdated(
            status.data.batches.map((b) => ({
              id: b.id,
              pipeline_run_id: id,
              user_id: "",
              keyword: b.keyword,
              status: b.status as EvaluationRunRow["status"],
              total_jobs: b.totalJobs,
              processed_jobs: b.processedJobs,
              failed_jobs: b.failedJobs,
              last_error: b.lastError,
              started_at: null,
              completed_at: b.updatedAt,
              created_at: b.updatedAt ?? new Date().toISOString(),
              updated_at: b.updatedAt ?? new Date().toISOString(),
            })),
          ),
        );
      }
      // Direct Supabase read as a second source (cheap, realtime-friendly).
      const runs = await getEvaluationRunsAction(id);
      if (!disposed && runs.ok && runs.runs.length) {
        dispatch(evaluationRunsUpdated(runs.runs));
      }
    }

    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationActive, activeRunId, evaluationStatus, dispatch]);

  function handleMatch() {
    if (!selected) return;
    // Use the selected key's own runId (account-wide) so matching works even
    // after a page reload when there's no active run in Redux.
    const targetRunId = runId ?? selectedKey?.runId ?? null;
    if (!targetRunId) {
      setEvalError("We couldn't find a search to match against.");
      return;
    }
    setEvalError(null);
    setJustStarted(false);
    setEvalRequesting(true);
    dispatch(runEvaluating());

    startTransition(async () => {
      const result = await startEvaluationAction(targetRunId, {
        searchKey: selected,
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
      // Success — tell the user clearly, and refresh the key list so the
      // just-matched key drops out once the evaluator finishes.
      setJustStarted(true);
      void reload();
    });
  }

  // ── Rendered states ────────────────────────────────────────────────
  // The match control is ALWAYS visible while there are search keys with
  // unevaluated posts — regardless of whether a run is active. This is the
  // user's explicit requirement: "should always appear if the user has job
  // keys that have not been evaluated posts."

  // Actively matching → show live per-key progress + the "started" cue.
  if (evaluationActive) {
    return (
      <div className="space-y-4">
        {justStarted && (
          <div
            role="status"
            className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-4 py-3 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2"
          >
            <svg
              className="w-4 h-4 animate-spin motion-reduce:hidden"
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
            Matching started —{" "}
            <strong className="font-semibold">{selectedKey?.keyword}</strong> (
            {selectedKey?.unevaluated} job
            {selectedKey?.unevaluated !== 1 ? "s" : ""}) is being scored now.
          </div>
        )}
        <EvaluationProgress />
      </div>
    );
  }

  // Evaluation just finished — show a clear "done" confirmation so the user
  // never doubts the evaluation ran.
  if (evaluationStatus === "completed") {
    return (
      <div className="space-y-4">
        {keys.length > 0 ? (
          /* Still other keys with unevaluated posts → show the selector */
          <>
            <div
              role="status"
              className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
            >
              <strong className="font-semibold">
                {selectedKey?.keyword ?? "Your search"}
              </strong>{" "}
              was matched. {counts.fit || 0} great fit
              {(counts.fit || 0) !== 1 ? "s" : ""} ready to review.
            </div>
            {renderSelector()}
          </>
        ) : (
          /* Everything matched */
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
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  All matched — nothing left to score.
                </p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                  {counts.fit || 0} great fit
                  {(counts.fit || 0) !== 1 ? "s" : ""} ready to review.
                </p>
              </div>
            </div>
            <button
              onClick={() => router.push("/matches")}
              className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
            >
              View matches →
            </button>
          </div>
        )}
      </div>
    );
  }

  // A previous evaluation failed — still show the selector so the user can retry.
  const failedCopy = evaluationStatus === "failed";

  // Nothing left to match and it never ran → quiet.
  if (keys.length === 0 && !failedCopy) return null;

  return renderSelector(failedCopy);

  /** The dropdown + Match button. Kept inline (no absolute clipping). */
  function renderSelector(showFailedCopy = false) {
    return (
      <div
        id="match-jobs"
        className="space-y-3 scroll-mt-24"
        ref={containerRef}
      >
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          {/* Search key selector — scrollable, account-wide, defaults to
              the current search's key */}
          <div className="flex-1 min-w-0">
            <label
              htmlFor="search-key-match"
              className="block text-xs font-medium text-[var(--ink-soft)] mb-1.5"
            >
              Search key to match
            </label>
            <div className="relative">
              <button
                id="search-key-match"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                onClick={() => setDropdownOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              >
                <span className="truncate">
                  {selectedKey ? (
                    <>
                      <span className="font-medium">{selectedKey.keyword}</span>
                      <span className="ml-2 text-xs text-[var(--ink-faint)]">
                        {selectedKey.unevaluated} job
                        {selectedKey.unevaluated !== 1 ? "s" : ""} to match
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--ink-faint)]">
                      No search keys with unevaluated jobs
                    </span>
                  )}
                </span>
                <svg
                  className={`w-4 h-4 text-[var(--ink-faint)] transition-transform ${
                    dropdownOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {/* Scrollable listbox */}
              {dropdownOpen && (
                <ul
                  role="listbox"
                  aria-label="Search keys"
                  className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-[var(--line)] bg-white dark:bg-zinc-900 shadow-lg py-1"
                >
                  {keys.length === 0 && (
                    <li className="px-4 py-2 text-sm text-[var(--ink-faint)]">
                      Nothing left to match.
                    </li>
                  )}
                  {keys.map((k) => {
                    const active = k.searchKey === selected;
                    const isCurrent = k.searchKey === defaultKey;
                    return (
                      <li
                        key={k.searchKey}
                        role="option"
                        aria-selected={active}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(k.searchKey);
                            setDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm text-left hover:bg-[var(--paper-soft)] transition-colors ${
                            active
                              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                              : "text-[var(--ink)]"
                          }`}
                        >
                          <span className="truncate font-medium">
                            {k.keyword}
                            {isCurrent && (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
                                Current
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-[var(--ink-faint)]">
                            {k.unevaluated} to match
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Match button */}
          <button
            onClick={handleMatch}
            disabled={!selected || evalRequesting}
            className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 shadow-sm transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            {evalRequesting ? (
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
                Starting…
              </>
            ) : (
              <>
                Match
                {selectedKey && selectedKey.unevaluated > 0
                  ? ` ${selectedKey.unevaluated} job${
                      selectedKey.unevaluated !== 1 ? "s" : ""
                    }`
                  : ""}{" "}
                →
              </>
            )}
          </button>
        </div>

        {isCurrentRunKey && keys.length > 1 && (
          <p className="text-xs text-[var(--ink-faint)]">
            Showing all your search keys with unevaluated posts — you can match
            any of them.
          </p>
        )}

        {/* Failed retry copy */}
        {showFailedCopy && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            The last match didn't finish — pick a key and try again.
          </p>
        )}

        {evalError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300"
          >
            {evalError}
          </div>
        )}
      </div>
    );
  }
}
