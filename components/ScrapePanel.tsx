"use client";

import { pollJobAction, startScrapeAction } from "@/app/actions/scrape";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

type Phase = "idle" | "starting" | "polling" | "done" | "error";

export default function ScrapePanel({ hasResume }: { hasResume: boolean }) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [pages, setPages] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();
  const [isRefreshing, refreshTransition] = useTransition();
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-refresh page when scrape completes
  useEffect(() => {
    if (phase === "done") {
      refreshTransition(() => {
        router.refresh();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function schedulePoll(id: string) {
    pollRef.current = setTimeout(async () => {
      const result = await pollJobAction(id);

      if (!result.ok) {
        setPhase("error");
        setErrorMsg(result.error);
        return;
      }

      setLogs(result.logs);

      if (result.status === "done") {
        setPhase("done");
        return;
      }
      if (result.status === "error") {
        setPhase("error");
        setErrorMsg("Scrape job failed on the server.");
        return;
      }

      schedulePoll(id); // keep polling
    }, 5000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;

    setPhase("starting");
    setLogs([]);
    setErrorMsg("");
    setJobId(null);
    if (pollRef.current) clearTimeout(pollRef.current);

    startTransition(async () => {
      const result = await startScrapeAction(keyword.trim(), pages);

      if (!result.ok) {
        setPhase("error");
        setErrorMsg(result.error);
        return;
      }

      setJobId(result.jobId);
      setPhase("polling");
      schedulePoll(result.jobId);
    });
  }

  function handleRefresh() {
    refreshTransition(() => {
      setPhase("idle");
      setLogs([]);
      setJobId(null);
    });
  }

  const isRunning = phase === "starting" || phase === "polling";

  return (
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
            Scrape &amp; analyse new listings from JobsDB and CTgoodjobs
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="px-6 py-5">
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
              placeholder="e.g. web dev, frontend, react"
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
              className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-5 py-2.5 transition-colors"
            >
              {isRunning ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 animate-spin"
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
                  Searching…
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
                  Search
                </>
              )}
            </button>
          </div>
        </div>

        {/* No resume warning */}
        {!hasResume && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            You need to upload your resume before searching for matches.{" "}
            <a
              href="/profile"
              className="font-semibold underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
            >
              Upload resume →
            </a>
          </p>
        )}
      </form>

      {/* Status / Logs area */}
      {phase !== "idle" && (
        <div className="px-6 pb-6 space-y-3">
          {/* Status bar */}
          <div
            className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium border ${
              phase === "done"
                ? "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                : phase === "error"
                  ? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
                  : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400"
            }`}
          >
            {phase === "done" && (
              <svg
                className="w-4 h-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            {phase === "error" && (
              <svg
                className="w-4 h-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            {(phase === "starting" || phase === "polling") && (
              <svg
                className="w-4 h-4 shrink-0 animate-spin"
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
            <span>
              {phase === "starting" && "Starting scrape job…"}
              {phase === "polling" &&
                `Scraping "${keyword}" · polling every 5s`}
              {phase === "done" && "Scrape complete! Refreshing results…"}
              {phase === "error" && errorMsg}
            </span>

            {/* Refresh button — shown when done */}
            {phase === "done" && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 transition-colors shrink-0"
              >
                {isRefreshing ? (
                  <>
                    <svg
                      className="w-3 h-3 animate-spin"
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
                    Refreshing…
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Dismiss
                  </>
                )}
              </button>
            )}
          </div>

          {/* Progress steps */}
          {logs.length > 0 && (
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-zinc-400">
                  Progress
                </span>
                <span className="text-xs text-zinc-500">
                  {logs.length} step{logs.length !== 1 ? "s" : ""} completed
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{
                    width:
                      phase === "done"
                        ? "100%"
                        : `${Math.min(90, logs.length * 10)}%`,
                  }}
                />
              </div>
              <div className="space-y-1 pt-1">
                {logs.map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <svg
                      className="w-3 h-3 text-emerald-500 shrink-0"
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
                    <span className="text-xs text-zinc-400">
                      Step {i + 1} completed
                    </span>
                  </div>
                ))}
                {phase === "polling" && (
                  <div className="flex items-center gap-2">
                    <svg
                      className="w-3 h-3 text-blue-400 shrink-0 animate-spin"
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
                    <span className="text-xs text-zinc-500 animate-pulse">
                      Working…
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
