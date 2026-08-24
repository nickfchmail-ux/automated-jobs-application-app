import ScrapePanelWithResume from "@/app/(main)/_resume";
import DashboardStats from "@/app/(main)/_stats";
import EvaluationStep from "@/components/EvaluationStep";
import RunHistory from "@/components/RunHistory";
import { getUserId } from "@/lib/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The dashboard shell has ZERO top-level awaits. The only thing awaited is
 * the auth check (fast). Every data-dependent section — the Search panel's
 * resume status, and the stat cards / app tracker / recent jobs — streams in
 * behind <Suspense>, so the user sees the UI immediately instead of a bare
 * "Loading dashboard…" spinner.
 */
export default async function Home() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-8">
        {/* Compact brand bar — replaces the giant logo hero */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold">
            <span className="text-lg">J</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 font-display">
              Your job search, simplified
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Scrape jobs, match them to your CV, and track your applications.
            </p>
          </div>
        </div>

        {/* Guided flow strip: Step 1 Search → Step 2 Match */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                1
              </span>
              Search
            </span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">
                2
              </span>
              Match
            </span>
          </div>
          <div className="p-5 space-y-5">
            <Suspense
              fallback={
                <div className="space-y-3">
                  <div className="h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                  <div className="h-7 w-64 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                </div>
              }
            >
              <ScrapePanelWithResume />
            </Suspense>
            <div className="border-t border-zinc-100 dark:border-zinc-800" />
            <EvaluationStep />
          </div>
        </div>

        <RunHistory />

        {/* Stat-heavy sections stream in so the Search → Match UI paints first */}
        <Suspense
          fallback={
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm animate-pulse"
                >
                  <div className="w-11 h-11 rounded-xl bg-zinc-100 dark:bg-zinc-800 mb-4" />
                  <div className="h-8 w-16 rounded bg-zinc-100 dark:bg-zinc-800 mb-2" />
                  <div className="h-3 w-28 rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              ))}
            </div>
          }
        >
          <DashboardStats />
        </Suspense>
      </main>
    </div>
  );
}
