import FitFilters from "@/components/FitFilters";
import type { Job } from "@/components/JobCard";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Jobs To Review",
};

/**
 * Jobs that have been scraped but NOT yet AI-evaluated (fit_score IS NULL).
 *
 * This is the "before evaluation" view: until the AI evaluator runs, every
 * scraped job lands here. Filterable by search key + job board via FitFilters.
 */
export default async function NotEvaluatedPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let jobs: Job[] = [];
  try {
    const result = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .is("fit_score", null);

    if (result.error) {
      console.error("[NotEvaluatedPage] Supabase query error:", result.error);
    } else {
      jobs = (result.data as Job[]) ?? [];
    }
  } catch (err) {
    console.error("[NotEvaluatedPage] Unexpected error fetching jobs:", err);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 font-display">
              To Review
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Jobs scraped but not yet scored by AI — filter by search key or
              job board
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <FitFilters
          jobs={jobs}
          emptyMessage="No unevaluated jobs — everything has been scored or you haven't scraped yet"
        />
      </main>
    </div>
  );
}
