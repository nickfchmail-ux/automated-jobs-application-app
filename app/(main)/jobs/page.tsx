import FitFilters from "@/components/FitFilters";
import type { Job } from "@/components/JobCard";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "All Jobs",
};

/**
 * All scraped jobs — BEFORE (or regardless of) AI evaluation.
 *
 * Unlike `/fit` and `/not-fit`, this page deliberately does NOT filter on
 * `fit` or `interested_in`, so the user can browse every job that was scraped
 * for them even when evaluation hasn't run yet. The `FitFilters` component is
 * evaluation-agnostic and already supports filtering by search key + board.
 */
export default async function AllJobsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let jobs: Job[] = [];
  try {
    const result = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId);

    if (result.error) {
      console.error("[AllJobsPage] Supabase query error:", result.error);
    } else {
      jobs = (result.data as Job[]) ?? [];
    }
  } catch (err) {
    console.error("[AllJobsPage] Unexpected error fetching jobs:", err);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              All Jobs
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Every job scraped for you — filter by search key or job board
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <FitFilters
          jobs={jobs}
          emptyMessage="No jobs yet — start a search to see scraped listings"
        />
      </main>
    </div>
  );
}
