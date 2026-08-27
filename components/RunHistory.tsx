"use client";

import { statsRunsAction } from "@/app/actions/scrape";
import type { FunnelCounts, RunSummary } from "@/types/api";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

const BOARD_LABELS: Record<string, string> = {
  jobsdb: "JobsDB",
  ctgoodjobs: "CTgoodjobs",
  offertoday: "OfferToday",
  linkedin: "LinkedIn",
};

/** A run older than this that still looks "in progress" is treated as stalled. */
const STALL_AFTER_MIN = 45;

/** Human copy for a run that never finished. */
const STALL_COPY = {
  label: "Didn't finish",
  detail: "Left incomplete — you can search again anytime.",
};

/** How long before "just now" becomes a real timestamp label. */
const JUST_NOW_MIN = 1;

/**
 * Derive a plain-English state + tone for a run.
 *
 * `status` is the authoritative `pipeline_runs.status` (now returned by
 * /stats/runs), so a finished run always reads "Done ✓" — never an
 * inferred "Searching the job boards…" from partial funnel counters. The
 * funnel counters only refine the *active* stages (how many being read /
 * found), and the age-check catches runs that look active but stalled.
 */
type RunState = {
  label: string;
  detail?: string;
  tone: "neutral" | "active" | "success" | "error" | "stalled";
};

function deriveRunState(
  status: string | null,
  counts: FunnelCounts,
  createdAt: string,
): RunState {
  const ageMin = ageInMinutes(createdAt);

  // Authoritative terminal states first — a completed run is done even if
  // the Redis funnel counters lack a `completed` bucket.
  if (status === "completed") {
    return { label: "Done ✓", tone: "success" };
  }
  if (status === "failed") {
    return { label: "Something went wrong", tone: "error" };
  }

  if ((counts.failed || 0) > 0) {
    return {
      label: "Something went wrong",
      detail: `${counts.failed} job${counts.failed === 1 ? "" : "s"} couldn't be saved`,
      tone: "error",
    };
  }

  // Actively loading details for at least one job.
  if ((counts.processing || 0) > 0) {
    return {
      label: "Loading job details…",
      detail: `${counts.processing} job${counts.processing === 1 ? "" : "s"} being read`,
      tone: "active",
    };
  }

  // AI matching has begun on some jobs.
  if ((counts.analysed || 0) > 0) {
    return {
      label: "Matching your resume…",
      detail: `${counts.analysed} job${counts.analysed === 1 ? "" : "s"} matched so far`,
      tone: "active",
    };
  }

  // At least one job made it through to the final saved state → done.
  if ((counts.completed || 0) > 0) {
    return { label: "Done ✓", tone: "success" };
  }

  // Still discovering jobs (unique found but nothing processed yet).
  if ((counts.unique || 0) > 0) {
    return {
      label: "Searching the job boards…",
      detail: `${counts.unique} new job${counts.unique === 1 ? "" : "s"} found so far`,
      tone: "active",
    };
  }

  // A run that never reported any progress → age-check it.
  if (ageMin >= STALL_AFTER_MIN) {
    return { ...STALL_COPY, tone: "stalled" };
  }
  if (status === "retrying") {
    return { label: "Hitting a snag, retrying…", tone: "active" };
  }
  return { label: "In line…", tone: "neutral" };
}

function ageInMinutes(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((Date.now() - then) / 60_000));
}

function timeAgo(iso: string): string {
  const mins = ageInMinutes(iso);
  if (mins < JUST_NOW_MIN) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * "My searches" — a quiet history of recent runs, fetched from
 * `GET /stats/runs`. Each row is rendered in plain language with the run
 * status and the funnel headline (found / great fits).
 */
export default function RunHistory() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const result = await statsRunsAction();
      if (!alive) return;
      if (result.ok) {
        setRuns(result.runs ?? []);
      } else {
        setError(true);
      }
    }
    void load();
    // Refresh occasionally so a run that was "In line…" settles to "Done ✓"
    // (or a new run appears) without a page reload. Every 60s keeps the
    // history fresh without hammering the server with POSTs while idle.
    const interval = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  if (error) return null; // quiet — the live card handles search errors
  if (!runs) return null; // still loading

  if (runs.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
    >
      <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          My searches
        </h2>
      </div>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {runs.slice(0, 6).map((run) => {
          const state = deriveRunState(run.status, run.counts, run.createdAt);
          const found = run.counts.scraped || 0;
          const saved = run.counts.unique || 0;
          const fits = run.counts.fit || 0;
          return (
            <motion.li
              key={run.runId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {run.keyword}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                  {run.boards.map((b) => BOARD_LABELS[b] ?? b).join(" · ")}
                  {run.createdAt ? ` · ${timeAgo(run.createdAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 w-full sm:w-auto">
                {/* Headline: how many new/saved */}
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {saved > 0 && (
                    <>
                      <strong className="font-semibold text-zinc-700 dark:text-zinc-300">
                        {saved}
                      </strong>{" "}
                      new saved
                      {found > saved && (
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {" · "}
                          {found} found
                        </span>
                      )}
                      {fits > 0 && (
                        <>
                          {" · "}
                          <strong className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {fits}
                          </strong>{" "}
                          fits
                        </>
                      )}
                    </>
                  )}
                </span>

                {/* Stage: what's happening right now (label + detail) */}
                <span className="flex flex-col items-end gap-0.5">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium ${
                      state.tone === "error"
                        ? "text-red-600 dark:text-red-400"
                        : state.tone === "success"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : state.tone === "active"
                            ? "text-blue-600 dark:text-blue-400"
                            : state.tone === "stalled"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    {state.tone === "active" && (
                      <svg
                        className="w-3 h-3 animate-spin motion-reduce:hidden"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
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
                    {state.tone === "stalled" && (
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    )}
                    {state.label}
                  </span>
                  {state.detail && (
                    <span
                      className={`text-[11px] ${
                        state.tone === "error"
                          ? "text-red-500 dark:text-red-400"
                          : state.tone === "stalled"
                            ? "text-amber-500 dark:text-amber-400"
                            : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {state.detail}
                    </span>
                  )}
                </span>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}
