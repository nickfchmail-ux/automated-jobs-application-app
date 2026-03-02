import Navbar from "@/components/Navbar";
import ScrapePanel from "@/components/ScrapePanel";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export const revalidate = 0;

export default async function Home() {
  const [{ count: fitCount }, { count: notFitCount }, { data: recent }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("fit", true),
      supabase
        .from("jobs")
        .select("*", { count: "exact", head: true })
        .eq("fit", false),
      supabase
        .from("jobs")
        .select("id, title, company, fit, fit_score, url, posted_date")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const total = (fitCount ?? 0) + (notFitCount ?? 0);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Navbar currentPath="/" />
      {/* Hero */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Jobs Dashboard
          </h1>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">
            {total} job{total !== 1 ? "s" : ""} scraped and analysed by AI
          </p>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-10 space-y-10">
        <ScrapePanel />
        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Link
            href="/fit"
            className="group block rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700 transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-emerald-500"
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
              </div>
              <svg
                className="w-4 h-4 text-zinc-300 group-hover:text-emerald-400 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
            <p className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
              {fitCount ?? 0}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Good Fit Jobs
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              AI marked these as a match for your profile
            </p>
          </Link>

          <Link
            href="/not-fit"
            className="group block rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm hover:shadow-md hover:border-red-300 dark:hover:border-red-700 transition-all"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-red-950 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-red-400"
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
              <svg
                className="w-4 h-4 text-zinc-300 group-hover:text-red-400 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
            <p className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
              {notFitCount ?? 0}
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Not a Fit
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
              Doesn't match your current experience level
            </p>
          </Link>
        </div>

        {/* Recently added */}
        {recent && recent.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-300 mb-4">
              Recently Scraped
            </h2>
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden shadow-sm">
              {recent.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 truncate block transition-colors"
                    >
                      {job.title}
                    </Link>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                      {job.company} · {job.posted_date}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-2 shrink-0">
                    {job.fit_score !== null && (
                      <span className="text-xs text-zinc-400">
                        {job.fit_score}/100
                      </span>
                    )}
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${job.fit ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"}`}
                    >
                      {job.fit ? "Fit" : "Not fit"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
