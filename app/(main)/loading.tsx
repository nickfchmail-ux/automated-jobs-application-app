import PageSpinner from "@/components/PageSpinner";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Navbar skeleton */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10 h-14" />

      {/* Hero skeleton */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12">
          <div className="h-8 w-48 rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          <div className="mt-2 h-4 w-64 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-10">
        <PageSpinner label="Loading dashboard…" />
      </main>
    </div>
  );
}
