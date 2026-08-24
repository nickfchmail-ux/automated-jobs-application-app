import EvaluationStep from "@/components/EvaluationStep";
import RunHistory from "@/components/RunHistory";
import { getUserId } from "@/lib/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Evaluate Jobs",
};

/**
 * Dedicated evaluation page — the home of the "Start matching" CTA.
 *
 * Hosts the evaluation trigger + live progress (EvaluationStep) and the run
 * history. Zero top-level awaits beyond the fast auth check; the interactive
 * bits are all client components.
 */
export default async function EvaluatePage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 font-display">
            Match your jobs
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Start the AI evaluation to score your scraped jobs against your
            resume and see which ones are worth applying to.
          </p>
        </div>

        {/* Start matching + live progress */}
        <EvaluationStep />

        {/* Quick links to results */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/fit"
            className="group flex items-center justify-between rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-4 hover:shadow-md transition-all"
          >
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                Good Fit Jobs
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                See jobs AI scored as a match
              </p>
            </div>
            <span className="text-emerald-500 group-hover:translate-x-0.5 transition-transform">
              →
            </span>
          </Link>
          <Link
            href="/not-fit"
            className="group flex items-center justify-between rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-5 py-4 hover:shadow-md transition-all"
          >
            <div>
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                Not Fit Jobs
              </p>
              <p className="text-xs text-rose-500 dark:text-rose-400 mt-0.5">
                See jobs AI scored as not a match
              </p>
            </div>
            <span className="text-rose-400 group-hover:translate-x-0.5 transition-transform">
              →
            </span>
          </Link>
        </div>

        {/* Run history */}
        <RunHistory />
      </main>
    </div>
  );
}
