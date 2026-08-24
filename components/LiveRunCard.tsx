"use client";

import { funnelProgress, runStatusCopy } from "@/lib/funnel";
import { runReset } from "@/state/global/slice/runSlice";
import type { RootState } from "@/state/global/store";
import type { PipelineRunStatus } from "@/types/api";
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import RunStatusBadge from "./RunStatusBadge";

const BOARD_META: Record<string, { label: string; color: string }> = {
  jobsdb: { label: "JobsDB", color: "bg-purple-500" },
  ctgoodjobs: { label: "CTgoodjobs", color: "bg-orange-500" },
  offertoday: { label: "OfferToday", color: "bg-teal-500" },
  linkedin: { label: "LinkedIn", color: "bg-sky-500" },
};

/**
 * The "run card" — walks the user through their live search in plain English:
 *   In line… → Searching the job boards… → Loading job details…
 *   → Matching jobs against your resume… → Done ✓
 * No refresh, no jargon. Board chips light up as the search fans out.
 */
export default function LiveRunCard() {
  const dispatch = useDispatch();
  const {
    phase,
    keyword,
    boards,
    counts,
    connection,
    errorMsg,
    jobStream,
    boardsDetail,
    evaluationStatus,
    evaluationRuns,
  } = useSelector((s: RootState) => s.run);

  const active =
    phase !== "idle" && phase !== "completed" && phase !== "failed";
  const copy = runStatusCopy(phase);
  const progress = funnelProgress(counts, phase as PipelineRunStatus);
  const found = counts.scraped || 0;
  const newJobs = counts.unique || 0;
  const fits = counts.fit || 0;
  const live = copy.live;

  // Per-board breakdown — single source of truth used by BOTH the board
  // chips and the per-board status line so they can never disagree.
  //
  // Sources, in priority order:
  //   1. Socket `stats:run` `boards` payload (authoritative: unique/scraped/
  //      duplicate/processing) — updates live from the backend.
  //   2. Realtime `jobStream` rows (fallback: scraped/completed derived from
  //      the job rows streaming in via Supabase Realtime).
  //
  // NOTE: hooks must be called unconditionally, before any early return.
  // Per-board breakdown — single source of truth used by BOTH the board
  // chips and the per-board table so they never disagree.
  //
  // Semantics (match the funnel exactly):
  //   found      = scraped  (total listings discovered for this board)
  //   newSaved   = unique   (scraped - duplicate → what's actually new)
  //   duplicate  = already in the user's list
  //   processing = jobs currently being read/enriched
  //   done       = jobs that reached completed/analysed
  //
  // Sources, in priority order:
  //   1. Socket `stats:boards` / `stats:run.boards` payload (authoritative).
  //   2. Realtime `jobStream` rows (fallback).
  const boardCounts = useMemo(() => {
    const merged = new Map<
      string,
      {
        found: number; // scraped
        newSaved: number; // unique
        processing: number;
        done: number;
        duplicate: number;
        socket: boolean;
        stage?: string;
        lastError?: string | null;
        displayName?: string;
      }
    >();

    // Seed from the socket's per-board payload.
    for (const [board, s] of Object.entries(boardsDetail)) {
      const found = s?.scraped ?? s?.unique ?? 0;
      const newSaved = s?.unique ?? 0;
      if (found > 0 || (s?.processing ?? 0) > 0 || s?.stage) {
        merged.set(board, {
          found,
          newSaved,
          processing: s?.processing ?? 0,
          done: 0,
          duplicate: s?.duplicate ?? 0,
          socket: true,
          stage: s?.stage,
          lastError: s?.lastError,
          displayName: s?.displayName,
        });
      }
    }

    // Merge in the Realtime job stream — ONLY for boards the socket hasn't
    // reported yet (fallback). The socket's `stats:boards` numbers are
    // authoritative and must not be overridden by the stream (e.g. the doc's
    // example: ctgoodjobs unique=0 even though job rows exist — they're
    // duplicates already in the user's list).
    for (const job of jobStream) {
      const b = job.board ?? "other";
      if (job.status === "duplicate") continue; // not a new save
      if (merged.has(b)) continue; // socket already owns this board
      const entry = merged.get(b) ?? {
        found: 0,
        newSaved: 0,
        processing: 0,
        done: 0,
        duplicate: 0,
        socket: false,
      };
      entry.found++;
      entry.newSaved++;
      if (job.status === "completed" || job.status === "analysed") entry.done++;
      merged.set(b, entry);
    }

    return merged;
  }, [boardsDetail, jobStream]);

  // Sum the per-board numbers so the headline matches the table. When the
  // socket provides per-board data, these are the authoritative totals the
  // user sees — the aggregate funnel (`counts`) can lag or disagree.
  const boardTotals = useMemo(() => {
    let newSaved = 0;
    let found = 0;
    for (const b of boardCounts.values()) {
      newSaved += b.newSaved;
      found += b.found;
    }
    return { newSaved, found };
  }, [boardCounts]);

  // Headline numbers — prefer the summed per-board data (matches the table)
  // and fall back to the aggregate funnel when per-board isn't available.
  const hasBoardData = boardTotals.newSaved > 0 || boardTotals.found > 0;
  const displayNewJobs = hasBoardData ? boardTotals.newSaved : newJobs;
  const displayFound = hasBoardData ? boardTotals.found : found;

  if (phase === "idle") return null;

  const resumeActive =
    (counts.resume_building || 0) + (counts.resume_done || 0) > 0;

  // Evaluation progress summary — how many keyword batches are done.
  const evalTotal = evaluationRuns.reduce((n, r) => n + (r.total_jobs ?? 0), 0);
  const evalProcessed = evaluationRuns.reduce(
    (n, r) => n + (r.processed_jobs ?? 0),
    0,
  );
  const evalActive = evaluationRuns.some(
    (r) => r.status === "evaluating" || r.status === "queued",
  );
  const showEvalSummary =
    (evaluationStatus === "evaluating" || evaluationStatus === "queued") &&
    evalTotal > 0;

  // Scrape finished but the AI match hasn't run yet → point to the next step
  // so the two separated steps (Search → Match) feel connected.
  const showMatchPrompt =
    phase === "completed" &&
    evaluationStatus === "none" &&
    (counts.unique || 0) > 0;

  // ── Stage strip — the "what's happening right now" funnel breakdown ──
  // Derived from the funnel counters PLUS the per-board `stage` values (from
  // `stats:boards`), so the headline reflects when boards finish instead of
  // staying stuck on "Found N — saving them…".
  const processingCount = counts.processing || 0;
  const analysedCount = counts.analysed || 0;
  const duplicateCount = counts.duplicate || 0;
  const failedCount = counts.failed || 0;

  // Aggregate per-board lifecycle from the socket's `stats:boards` stages.
  const boardStages = [...boardCounts.values()].map((b) => b.stage);
  const allBoardsDone =
    boards.length > 0 &&
    boardStages.length > 0 &&
    boardStages.every((s) => s === "done");
  const anyBoardBlocked = boardStages.some((s) => s === "blocked");
  const anyBoardFailed = boardStages.some((s) => s === "failed");
  const anyBoardWorking = boardStages.some(
    (s) => s === "fetching" || s === "extracting",
  );

  // Primary stage — what the pipeline is doing right now. Failures are shown
  // as a supporting note (some jobs can fail while the run continues), not as
  // the headline — unless the run itself is terminally failed.
  const stage = (() => {
    if (phase === "failed")
      return {
        icon: "error",
        label: "This search didn't finish",
        tone: "text-red-600 dark:text-red-400",
        bar: "bg-red-400",
      } as const;
    if (allBoardsDone || phase === "completed")
      return {
        icon: "success",
        label: `All boards done — ${displayNewJobs} new job${displayNewJobs === 1 ? "" : "s"} saved`,
        tone: "text-emerald-600 dark:text-emerald-400",
        bar: "bg-emerald-500",
      } as const;
    if (anyBoardBlocked)
      return {
        icon: "active",
        label: "One board hit anti-bot protection — retrying…",
        tone: "text-amber-600 dark:text-amber-400",
        bar: "bg-amber-500",
      } as const;
    if (anyBoardFailed)
      return {
        icon: "error",
        label: "One board couldn't be searched",
        tone: "text-red-600 dark:text-red-400",
        bar: "bg-red-400",
      } as const;
    if (processingCount > 0)
      return {
        icon: "active",
        label: `Reading full details on ${processingCount} job${processingCount === 1 ? "" : "s"}…`,
        tone: "text-blue-600 dark:text-blue-400",
        bar: "bg-blue-500",
      } as const;
    if (analysedCount > 0)
      return {
        icon: "active",
        label: `Matching ${analysedCount} job${analysedCount === 1 ? "" : "s"} against your resume…`,
        tone: "text-indigo-600 dark:text-indigo-400",
        bar: "bg-indigo-500",
      } as const;
    if (displayNewJobs > 0)
      return {
        icon: "active",
        label: `Found ${displayNewJobs} new job${displayNewJobs === 1 ? "" : "s"} — saving them…`,
        tone: "text-blue-600 dark:text-blue-400",
        bar: "bg-blue-500",
      } as const;
    // No jobs seen yet — queued / still waiting on the boards.
    return {
      icon: "active",
      label:
        phase === "queued"
          ? "Waiting in line — your search is queued…"
          : "Contacting the job boards…",
      tone: "text-blue-600 dark:text-blue-400",
      bar: "bg-blue-500",
    };
  })();

  // Supporting context — shown under the stage so partial failures don't
  // alarm the user but aren't hidden either.
  const subNotes: string[] = [];
  if (failedCount > 0 && phase !== "failed") {
    subNotes.push(
      `${failedCount} job${failedCount === 1 ? "" : "s"} couldn't be saved`,
    );
  }
  if (duplicateCount > 0) {
    subNotes.push(`${duplicateCount} already in your list`);
  }

  const showStageStrip = active && phase !== "evaluating"; // evaluating already has its own summary

  return (
    <div
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden"
      aria-label="Your job search"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="relative flex w-2.5 h-2.5 shrink-0"
            aria-hidden="true"
          >
            {live && !allBoardsDone && (
              <span
                className={`absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 motion-safe:animate-ping`}
              />
            )}
            <span
              className={`relative inline-flex rounded-full w-2.5 h-2.5 ${
                allBoardsDone
                  ? "bg-emerald-500"
                  : live
                    ? "bg-blue-500"
                    : "bg-emerald-500"
              }`}
            />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
              My job search
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
              {keyword ? `"${keyword}"` : "…"}
            </p>
          </div>
        </div>

        {active && !allBoardsDone && (
          <button
            onClick={() => dispatch(runReset())}
            className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Status + boards */}
      <div className="px-5 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusBadge status={allBoardsDone ? "completed" : phase} />

          {/* Live-feed connection state — the user always knows if the
              counters are live or stale. */}
          {active && connection === "connected" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="relative flex w-1.5 h-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-emerald-500" />
              </span>
              Live
            </span>
          )}
          {active && connection === "connecting" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
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
              Connecting…
            </span>
          )}
          {active && connection === "disconnected" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
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
              Reconnecting…
            </span>
          )}
        </div>

        {/* Stage strip — exactly what's happening right now */}
        {showStageStrip && (
          <div
            className="flex items-center gap-2.5 text-xs"
            role="status"
            aria-live="polite"
          >
            {stage.icon === "active" ? (
              <svg
                className="w-3.5 h-3.5 animate-spin motion-reduce:hidden text-blue-500"
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
            ) : stage.icon === "success" ? (
              <svg
                className="w-3.5 h-3.5 text-emerald-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="w-3.5 h-3.5"
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
            <span className={`font-medium ${stage.tone}`}>{stage.label}</span>
            {subNotes.length > 0 && (
              <span className="text-zinc-400 dark:text-zinc-500">
                {subNotes.map((note, i) => (
                  <span key={note}>
                    {i > 0 && " · "}
                    {note}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {/* Board chips — one per selected board, driven by the socket's
            `stats:boards` `stage` + live counters. Shows searching spinner,
            done ✓, blocked ⚠, or failed, plus the live found count. */}
        {boards.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {boards.map((b) => {
              const meta = BOARD_META[b] ?? { label: b, color: "bg-zinc-500" };
              const info = boardCounts.get(b);
              const stage = info?.stage;
              const liveCount = info?.newSaved ?? 0;
              const label = info?.displayName || meta.label;

              const lit =
                phase === "scraping" ||
                phase === "processing" ||
                phase === "evaluating" ||
                phase === "completed";

              // Stage → chip appearance.
              const isWorking = stage === "fetching" || stage === "extracting";
              const isDone = stage === "done";
              const isProblem =
                stage === "blocked" ||
                stage === "failed" ||
                stage === undefined;

              const chipTone = isDone
                ? `border-transparent text-white ${meta.color}`
                : isProblem
                  ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
                  : lit
                    ? `border-transparent text-white ${meta.color}`
                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400";

              return (
                <span
                  key={b}
                  title={info?.lastError ?? undefined}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${chipTone}`}
                >
                  {isWorking && (
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
                  {isDone && (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                  {isProblem && !isWorking && (
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
                  {liveCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-white/25 text-[10px] font-semibold">
                      {liveCount}
                    </span>
                  )}
                  {label}
                </span>
              );
            })}
          </div>
        )}

        {/* Scrape done, not matched yet — a quiet pointer to the Match step */}
        {showMatchPrompt && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3"
            role="status"
            aria-live="polite"
          >
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              <strong className="font-semibold">
                {counts.unique || 0} new
              </strong>{" "}
              jobs found — ready to match against your resume.
            </p>
            <a
              href="#match-jobs"
              className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 rounded-lg px-3 py-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
            >
              Match jobs →
            </a>
          </div>
        )}

        {/* Progress bar */}
        {(phase === "queued" ||
          phase === "scraping" ||
          phase === "processing" ||
          phase === "retrying" ||
          phase === "evaluating") && (
          <div
            className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Evaluation summary — "Matching 'react' — 12 of 20 jobs…" */}
        {showEvalSummary && (
          <div
            className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2"
            role="status"
            aria-live="polite"
          >
            <svg
              className="w-3.5 h-3.5 text-blue-500 animate-spin motion-reduce:hidden"
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
            {evalActive
              ? `Matching ${evalProcessed} of ${evalTotal} jobs against your resume…`
              : `Preparing to match ${evalTotal} jobs…`}
          </div>
        )}

        {/* Funnel stats — lead with the number that matters (unique/saved),
            then explain the raw scrape total + duplicates parenthetically so
            "found" vs "new" never reads as two competing numbers. */}
        {displayNewJobs > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pt-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                {displayNewJobs}
              </strong>{" "}
              new {displayNewJobs === 1 ? "job" : "jobs"} saved
              {displayFound > displayNewJobs && (
                <span className="text-zinc-400 dark:text-zinc-500">
                  {" "}
                  · {displayFound} found,{" "}
                  {displayFound - displayNewJobs} already in your list
                </span>
              )}
            </span>
            {fits > 0 && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                <strong className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {fits}
                </strong>{" "}
                great fits
              </span>
            )}
            {resumeActive && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                <strong className="font-semibold text-blue-600 dark:text-blue-400">
                  {(counts.resume_done || 0) + (counts.resume_building || 0)}
                </strong>{" "}
                resumes ready
              </span>
            )}
          </div>
        )}

        {/* Per-board table — one row per board, each with its own live
            values (stage, found, reading, done). Updates from the socket's
            `stats:boards` / `stats:run` payloads, with the Realtime job
            stream as a fallback so every board always shows real numbers. */}
        {boards.length > 0 && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500">
                    <th className="text-left font-medium px-3 py-1.5">Board</th>
                    <th className="text-right font-medium px-3 py-1.5">
                      New
                    </th>
                    <th className="text-right font-medium px-3 py-1.5">
                      Found
                    </th>
                    <th className="text-right font-medium px-3 py-1.5">
                      Dup
                    </th>
                    <th className="text-right font-medium px-3 py-1.5">
                      Reading
                    </th>
                    <th className="text-right font-medium px-3 py-1.5">Done</th>
                    <th className="text-left font-medium px-3 py-1.5">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {/* If NO per-board data has arrived for ANY selected board,
                      show the aggregate funnel so the user still sees the
                      real totals instead of misleading zeros. Only when truly
                      nothing has streamed yet — so it never flickers in and
                      out as boards report one-by-one. */}
                  {!hasBoardData &&
                    boards.every((b) => {
                      const m = boardCounts.get(b);
                      return !m || ((m?.newSaved ?? 0) === 0 && !m?.stage);
                    }) && (
                    <tr className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-2 font-medium text-zinc-500 dark:text-zinc-400">
                        All boards
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {displayNewJobs}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {displayFound}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {duplicateCount > 0 ? duplicateCount : "–"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        {processingCount > 0 ? processingCount : "–"}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                        –
                      </td>
                      <td className="px-3 py-2 text-left">
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {displayNewJobs > 0
                            ? `${displayNewJobs} new · ${duplicateCount} duplicate`
                            : phase === "completed"
                              ? "No new jobs"
                              : "Working…"}
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Per-board rows only when there's real per-board data —
                      otherwise the "All boards" fallback above is the only
                      row, so they never both show together. */}
                  {hasBoardData &&
                    boards.map((board) => {
                    const meta = BOARD_META[board] ?? {
                      label: board,
                      color: "bg-zinc-500",
                    };

                    // Single merged source shared with the board chips.
                    const merged = boardCounts.get(board);
                    const newSaved = merged?.newSaved ?? 0;
                    const foundCount = merged?.found ?? 0;
                    const duplicate = merged?.duplicate ?? 0;
                    const processing = merged?.processing ?? 0;
                    const done = merged?.done ?? 0;
                    const stage = merged?.stage;
                    const label = merged?.displayName || meta.label;
                    const finished =
                      phase === "completed" || phase === "failed";

                    // stage → status copy + tone
                    const stageCopy = (() => {
                      const err = merged?.lastError ?? "";
                      switch (stage) {
                        case "done":
                          return {
                            text: "Done ✓",
                            tone: "text-emerald-600 dark:text-emerald-400",
                          };
                        case "blocked":
                          return {
                            text: `Blocked — anti-bot${err ? `: ${err.slice(0, 40)}` : ""}`,
                            tone: "text-amber-600 dark:text-amber-400",
                          };
                        case "failed":
                          return {
                            text: `Failed${err ? `: ${err.slice(0, 40)}` : ""}`,
                            tone: "text-red-600 dark:text-red-400",
                          };
                        case "fetching":
                          return {
                            text: "Fetching jobs…",
                            tone: "text-blue-600 dark:text-blue-400",
                          };
                        case "extracting":
                          return {
                            text: "Reading details…",
                            tone: "text-indigo-600 dark:text-indigo-400",
                          };
                        case "pending":
                          return {
                            text: "Not started",
                            tone: "text-zinc-400 dark:text-zinc-500",
                          };
                        default:
                          return {
                            text:
                              newSaved > 0
                                ? "Saving…"
                                : finished
                                  ? "None found"
                                  : "Waiting…",
                            tone: "text-zinc-400 dark:text-zinc-500",
                          };
                      }
                    })();

                    const working =
                      stage === "fetching" || stage === "extracting";

                    return (
                      <tr
                        key={board}
                        className="bg-white dark:bg-zinc-900"
                        title={merged?.lastError ?? undefined}
                      >
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-400">
                            <span
                              className={`relative flex w-2 h-2`}
                              aria-hidden="true"
                            >
                              {(working || processing > 0) && (
                                <span
                                  className={`absolute inline-flex h-full w-full rounded-full ${meta.color} opacity-75 motion-safe:animate-ping`}
                                />
                              )}
                              <span
                                className={`relative inline-flex rounded-full w-2 h-2 ${meta.color} ${
                                  finished ? "opacity-60" : ""
                                }`}
                              />
                            </span>
                            {label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {newSaved}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {foundCount}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400 dark:text-zinc-500 tabular-nums">
                          {duplicate > 0 ? duplicate : "0"}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {processing > 0 ? processing : "–"}
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-500 dark:text-zinc-400 tabular-nums">
                          {done > 0 ? done : "–"}
                        </td>
                        <td className="px-3 py-2 text-left">
                          <span className={stageCopy.tone}>
                            {working && (
                              <svg
                                className="inline w-3 h-3 mr-1 animate-spin motion-reduce:hidden"
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
                            {stageCopy.text}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Run failed — surface last_error in warm copy */}
        {phase === "failed" && errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300"
          >
            Something went wrong: {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}
