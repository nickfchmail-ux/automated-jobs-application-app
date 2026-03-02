import JobCard, { Job } from "@/components/JobCard";
import Navbar from "@/components/Navbar";
import { supabase } from "@/lib/supabase";

export const revalidate = 0;

export default async function NotFitPage() {
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("fit", false)
    .order("fit_score", { ascending: false });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Navbar currentPath="/not-fit" />
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-red-500 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Not a Fit
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {jobs
                ? `${jobs.length} job${jobs.length !== 1 ? "s" : ""} that didn't match your profile`
                : "Loading..."}
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 px-5 py-4 text-red-700 dark:text-red-300 mb-6">
            <strong>Error:</strong> {error.message}
          </div>
        )}

        {!error && (!jobs || jobs.length === 0) && (
          <div className="text-center py-20 text-zinc-400 dark:text-zinc-500">
            <svg
              className="w-12 h-12 mx-auto mb-3 opacity-40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-lg font-medium">No unfit jobs found</p>
          </div>
        )}

        {jobs && jobs.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {(jobs as Job[]).map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
