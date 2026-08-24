"use client";

import { startScrapeAction } from "@/app/actions/scrape";
import LiveRunCard from "@/components/LiveRunCard";
import RealtimeJobStream from "@/components/RealtimeJobStream";
import { useRealtimeRun } from "@/hooks/useRealtimeRun";
import {
  runQueued,
  runStarting,
  runSucceeded,
} from "@/state/global/slice/runSlice";
import type { RootState } from "@/state/global/store";
import { SUPPORTED_BOARDS } from "@/types/api";
import { useEffect, useState, useTransition } from "react";
import { useDispatch, useSelector } from "react-redux";

const BOARD_OPTIONS: { value: string; label: string }[] = [
  { value: "jobsdb", label: "JobsDB" },
  { value: "ctgoodjobs", label: "CTgoodjobs" },
  { value: "offertoday", label: "OfferToday" },
  { value: "linkedin", label: "LinkedIn" },
];

export default function ScrapePanel({ hasResume }: { hasResume: boolean }) {
  const dispatch = useDispatch();
  const { phase, runId, jobStream, counts } = useSelector(
    (s: RootState) => s.run,
  );
  const [keyword, setKeyword] = useState("");
  const [pages, setPages] = useState(1);
  const [boards, setBoards] = useState<string[]>(() => [
    ...SUPPORTED_BOARDS.slice(0, 2),
  ]);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Live connection: socket.io funnel + Supabase Realtime job rows
  useRealtimeRun(true);

  // Derived completion: the backend may leave the pipeline_runs row at
  // "processing" even after every job is finished. If all streamed jobs are
  // in a terminal state (completed/failed/duplicate) and we've seen at least
  // one, treat the run as done so the user sees "Done ✓".
  useEffect(() => {
    if (phase !== "processing" && phase !== "scraping" && phase !== "queued") {
      return;
    }
    if (jobStream.length === 0) return;
    const terminal = ["completed", "failed", "duplicate"];
    const allDone = jobStream.every((j) => terminal.includes(j.status ?? ""));
    if (allDone) {
      dispatch(runSucceeded());
    }
  }, [phase, jobStream, dispatch]);

  const isRunning =
    phase !== "idle" && phase !== "completed" && phase !== "failed";

  function toggleBoard(value: string) {
    setBoards((prev) =>
      prev.includes(value) ? prev.filter((b) => b !== value) : [...prev, value],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setError(null);
    dispatch(runStarting({ keyword: keyword.trim(), boards }));

    startTransition(async () => {
      const result = await startScrapeAction({
        keyword: keyword.trim(),
        pages,
        boards,
      });

      if (!result.ok) {
        // Friendly copy — no status codes, no jargon
        if (/429|limit|quota/i.test(result.error)) {
          setError("You've hit today's search limit. It resets at midnight.");
        } else if (/rate|too many|busy/i.test(result.error)) {
          setError(
            "The job boards are busy right now — we couldn't get through. Please try again in a moment.",
          );
        } else {
          setError(
            "Something went wrong. Your saved jobs are safe — please try again.",
          );
        }
        return;
      }

      dispatch(runQueued({ runId: result.runId, keyword: keyword.trim() }));
    });
  }

  function handleRetry() {
    setError(null);
    handleSubmit({ preventDefault: () => {} } as React.FormEvent);
  }

  return (
    <div className="space-y-4">
      {/* Search form */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Search Jobs
            </h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Find and analyse new listings from the job boards
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label
                htmlFor="keyword"
                className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
              >
                Keyword
              </label>
              <input
                id="keyword"
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. web developer, frontend, react"
                disabled={isRunning}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
              />
            </div>

            <div className="sm:w-28">
              <label
                htmlFor="pages"
                className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5"
              >
                Pages
              </label>
              <select
                id="pages"
                value={pages}
                onChange={(e) => setPages(Number(e.target.value))}
                disabled={isRunning}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition"
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "page" : "pages"}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:self-end">
              <button
                type="submit"
                disabled={isRunning || !keyword.trim() || !hasResume}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 shadow-sm hover:shadow transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                {isRunning ? (
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
                    Finding jobs…
                  </>
                ) : (
                  <>
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
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    Find me jobs
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Board toggles */}
          <div>
            <span className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
              Job boards
            </span>
            <div className="flex flex-wrap gap-2">
              {BOARD_OPTIONS.map((b) => {
                const on = boards.includes(b.value);
                return (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => toggleBoard(b.value)}
                    disabled={isRunning}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      on
                        ? "bg-indigo-600 border-transparent text-white"
                        : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-indigo-300 dark:hover:border-indigo-600"
                    }`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* No resume warning */}
          {!hasResume && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              You need to upload your resume before searching for matches.{" "}
              <a
                href="/profile"
                className="font-semibold underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
              >
                Upload resume →
              </a>
            </p>
          )}

          {/* Error state — warm copy, never jargon */}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 flex items-center justify-between gap-3"
            >
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              <button
                onClick={handleRetry}
                className="shrink-0 text-xs font-semibold text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-lg px-3 py-1.5 hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Live run card */}
      <LiveRunCard />

      {/* Live job stream */}
      {(phase === "queued" ||
        phase === "scraping" ||
        phase === "processing" ||
        phase === "retrying" ||
        phase === "evaluating" ||
        phase === "completed") && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
              New this search
            </h2>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {counts.unique || 0} new
            </span>
          </div>
          <RealtimeJobStream jobs={jobStream} total={counts.unique || 0} />
        </div>
      )}
    </div>
  );
}
