import FitFilters from "@/components/FitFilters";
import type { Job } from "@/components/JobCard";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Skipped Jobs",
};

export default async function NotInterestedPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let jobs: Job[] = [];
  try {
    const result = await supabase
      .from("jobs")
      .select("*")
      .eq("interested_in", false)
      .eq("user_id", userId);

    if (result.error) {
      console.error("[NotInterestedPage] Supabase query error:", result.error);
    } else {
      jobs = (result.data as Job[]) ?? [];
    }
  } catch (err) {
    console.error("[NotInterestedPage] Unexpected error fetching jobs:", err);
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
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 font-display">
              Skipped
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Jobs you&apos;ve skipped
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <FitFilters jobs={jobs} emptyMessage="No skipped jobs yet" />
      </main>
    </div>
  );
}
