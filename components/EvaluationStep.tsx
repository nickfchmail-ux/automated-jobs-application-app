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
  evaluationStatusUpdated,
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
  const { runId, keyword, evaluationStatus, evaluationRuns } = useSelector(
    (s: RootState) => s.run,
  );
  const [, startTransition] = useTransition();

  // ALWAYS load the account-wide search keys with unevaluated posts — the
  // match control must be visible whenever there's anything left to match,
  // even after a page reload (when Redux has no active run). `runId` is only
  // used to highlight the current search's key.
  const { keys, reload, loaded } = useSearchKeys(runId, true, evaluationStatus);
  const [selected, setSelected] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalRequesting, setEvalRequesting] = useState(false);
  const [justStarted, setJustStarted] = useState(false);
  // Set when the user clicks "Back to match" — dismisses the completed
  // confirmation so the dropdown selector returns.
  const [dismissed, setDismissed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Authoritative fit count for the CURRENT match key — from the account-wide
  // socket/status `evaluationRuns` (the Redis funnel `counts.fit` is never
  // updated by the evaluator, so it stays 0). Used by the completed
  // confirmation instead of `counts.fit`. Note: `selected` may be "" while
  // keys are still loading, so fall back to summing the run's own batches.
  const selectedKeyNorm = selected.trim().toLowerCase().replace(/\s+/g, "_");
  const scopedRuns = evaluationRuns.filter((r) =>
    selectedKeyNorm
      ? (r.keyword ?? "").toLowerCase().replace(/\s+/g, "_") ===
        selectedKeyNorm
      : true,
  );
  const completedFit = scopedRuns.reduce((n, r) => n + (r.fit_jobs ?? 0), 0);
  // The scoped batches are the source of truth for "is this match done?" —
  // the global `evaluationStatus` can stay "evaluating" (another key's batch
  // active account-wide, or a stale socket event), which would otherwise keep
  // the panel stuck on the live view with no "Back to match" button.
  const scopedDone =
    scopedRuns.length > 0 &&
    scopedRuns.every(
      (r) => r.status === "completed" || r.status === "failed",
    );

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
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Re-fetch the account-wide search keys so a just-matched key drops out and
   * any remaining keys (with unevaluated posts) reappear. Used by the
   * "Match another key" button and on evaluation completion.
   */
  async function refreshKeys() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  /**
   * Leave the completed confirmation and return to the match dropdown.
   * Sets `dismissed` so the "All matched" confirmation is hidden and the
   * normal selector (or the "nothing left to match" explanation) renders
   * again, then refreshes the search keys so any newly-available key
   * reappears in the dropdown.
   */
  async function backToMatch() {
    setDismissed(true);
    setEvalError(null);
    await refreshKeys();
  }

  // The run whose evaluation state we track — the active run, else the
  // selected key's run (survives page reload when Redux has no active run).
  const activeRunId = runId ?? selectedKey?.runId ?? null;

  // Auto-refresh keys once evaluation reaches a terminal state — this drops
  // the just-matched key (now fully scored) and surfaces any remaining keys.
  useEffect(() => {
    if (evaluationStatus === "completed" || evaluationStatus === "failed") {
      const t = setTimeout(() => void refreshKeys(), 1200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationStatus]);

  /**
   * FINAL authoritative refresh when the evaluation completes.
   *
   * The socket `stats` event can carry stale fit/not-fit counts (a race with
   * the job-row writes), and for ACCOUNT-WIDE (search-key) evaluations the
   * scored jobs span multiple runs — so the run-scoped `jobStream` misses
   * them and the panel can show "0 fit / 0 not fit". Fetching the evaluator's
   * status endpoint (which computes fit/not-fit account-wide, correctly)
   * once more and dispatching it guarantees the completed panel shows the
   * real numbers.
   */
  useEffect(() => {
    if (evaluationStatus !== "completed" || !activeRunId) return;
    const id = activeRunId;
    let disposed = false;
    const t = setTimeout(async () => {
      const status = await getEvaluationStatusAction(id);
      if (disposed || !status.ok || !status.data.batches?.length) return;
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
            fit_jobs: b.fitJobs ?? 0,
            not_fit_jobs: b.notFitJobs ?? 0,
            remaining_jobs: b.remainingJobs ?? 0,
            last_error: b.lastError,
            started_at: null,
            completed_at: b.updatedAt,
            created_at: b.updatedAt ?? new Date().toISOString(),
            updated_at: b.updatedAt ?? new Date().toISOString(),
          })),
        ),
      );
    }, 800);
    return () => {
      disposed = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationStatus, activeRunId]);

  // ── Live progress poller (fallback to Realtime) ────────────────────
  // While an evaluation is active, poll the evaluator's REST status + read
  // `evaluation_runs` directly so the UI never freezes on "0 of 0 jobs"
  // even if Supabase Realtime isn't delivering the table's changes.
  useEffect(() => {
    if (!evaluationActive || !activeRunId) return;
    const id = activeRunId; // narrow to string for the async closure
    let disposed = false;

    async function poll() {
      if (disposed) return;
      // Primary source: REST status from the evaluator. It now returns
      // fit/not-fit/remaining per batch (mirrors the socket payload), so this
      // drives the table with real numbers.
      const status = await getEvaluationStatusAction(id);
      if (!disposed && status.ok && status.data.batches?.length) {
        const batches = status.data.batches;
        dispatch(
          evaluationRunsUpdated(
            batches.map((b) => ({
              id: b.id,
              pipeline_run_id: id,
              user_id: "",
              keyword: b.keyword,
              status: b.status as EvaluationRunRow["status"],
              total_jobs: b.totalJobs,
              processed_jobs: b.processedJobs,
              failed_jobs: b.failedJobs,
              fit_jobs: b.fitJobs ?? 0,
              not_fit_jobs: b.notFitJobs ?? 0,
              remaining_jobs: b.remainingJobs ?? 0,
              last_error: b.lastError,
              started_at: null,
              completed_at: b.updatedAt,
              created_at: b.updatedAt ?? new Date().toISOString(),
              updated_at: b.updatedAt ?? new Date().toISOString(),
            })),
          ),
        );
        // Detect terminal state from the batches so the UI never stays stuck
        // on "Matching… Live" even if the socket/realtime completion event is
        // missed: all batches done → overall evaluation completed (or failed
        // if nothing was processed).
        const allTerminal = batches.every(
          (b) => b.status === "completed" || b.status === "failed",
        );
        if (allTerminal) {
          const anyProcessed = batches.some(
            (b) => b.processedJobs > 0 || b.status === "completed",
          );
          dispatch(
            evaluationStatusUpdated(anyProcessed ? "completed" : "failed"),
          );
        }
        return; // REST is authoritative — skip the DB fallback
      }
      // Fallback: direct Supabase read (no fit counts) only when REST failed.
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
    setDismissed(false);
    setEvalRequesting(true);
    dispatch(runEvaluating());

    startTransition(async () => {
      const result = await startEvaluationAction(targetRunId, {
        searchKey: selected,
      });
      setEvalRequesting(false);
      if (!result.ok) {
        // Roll the evaluation state back so the selector (dropdown + Match
        // button) reappears — otherwise `runEvaluating()` left the status
        // at "evaluating" and the user would be stuck on the progress view
        // with an error, forced to reload to retry.
        dispatch(evaluationStatusUpdated("none"));
        if (/resume/i.test(result.error)) {
          setEvalError(
            "You need to upload your resume before we can match jobs to it.",
          );
        } else if (/already being matched/i.test(result.error)) {
          setEvalError(
            "That search is already being matched — give it a moment and try again.",
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
  // Only while the scoped batches are still running — once they're done we
  // drop into the completed view below (even if the global evaluationStatus
  // still says evaluating due to another key's batch or a stale socket event).
  // `!dismissed` lets the "Back to match" button exit this live view too.
  if (evaluationActive && !scopedDone && !dismissed) {
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
        <EvaluationProgress activeKey={selected} runId={activeRunId} />
        {/* Always allow returning to the dropdown — even mid-run or when the
            live view would otherwise linger. */}
        <button
          type="button"
          onClick={backToMatch}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)] border border-[var(--line)] rounded-lg px-3 py-1.5 hover:bg-[var(--paper-soft)] transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to match
        </button>
      </div>
    );
  }

  // Evaluation just finished — show a clear "done" confirmation so the user
  // never doubts the evaluation ran. `scopedDone` is based on the ACTUAL
  // batch data for the matched key (not a stale account-wide status), so it's
  // safe to show even on a fresh page load where the match already finished —
  // the "Back to match" button is always available to return to the dropdown.
  if (scopedDone && !dismissed) {
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
              was matched. {completedFit} great fit
              {completedFit !== 1 ? "s" : ""} ready to review.
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
                  {completedFit} great fit
                  {completedFit !== 1 ? "s" : ""} ready to review.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={backToMatch}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors disabled:opacity-50"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                {refreshing ? "Refreshing…" : "Back to match"}
              </button>
              <button
                onClick={() => router.push("/matches")}
                className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
              >
                View matches →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // A previous evaluation failed — still show the selector so the user can retry.
  const failedCopy = evaluationStatus === "failed";

  // Nothing left to match and it never ran → quiet.
  if (keys.length === 0 && !failedCopy) {
    // Still loading the account-wide search keys → show a spinner instead of
    // a flash of "nothing left" or an empty dropdown.
    if (!loaded) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-[var(--ink-soft)]"
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
          <span>Loading your search keys…</span>
        </div>
      );
    }

    // Loaded, but genuinely nothing left to match → explain why instead of
    // showing an empty dropdown.
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-[var(--ink-soft)]">
        {completedFit > 0 ? (
          <p>
            You&apos;ve matched every job in your search.{" "}
            <strong className="font-semibold text-[var(--ink)]">
              {completedFit} great fit
              {completedFit !== 1 ? "s" : ""}
            </strong>{" "}
            ready to review in{" "}
            <button
              onClick={() => router.push("/matches")}
              className="text-[var(--accent)] hover:underline font-medium"
            >
              Matches
            </button>
            .
          </p>
        ) : (
          <p>
            There are no jobs left to match right now. Run a new search or
            scrape more jobs to get fit recommendations for your resume.
          </p>
        )}
      </div>
    );
  }

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
                    <li className="px-4 py-3 text-sm text-[var(--ink-faint)]">
                      All your search keys have been matched — there&apos;s
                      nothing left to score right now.
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
            The last match didn&apos;t finish — pick a key and try again.
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
