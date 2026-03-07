import PageSpinner from "@/components/PageSpinner";

export default function ProfileLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Navbar skeleton */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10 h-14" />

      {/* Page header skeleton */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 sm:px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 animate-pulse shrink-0" />
          <div className="space-y-1.5">
            <div className="h-6 w-24 rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
            <div className="h-3.5 w-60 rounded bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 sm:px-8 py-8">
        <PageSpinner label="Loading profile…" />
      </main>
    </div>
  );
}
