import PageSpinner from "./PageSpinner";

/**
 * Shared loading skeleton for the authenticated `(main)` route group.
 *
 * Each top-level page (Overview, Search, Matches, Review, Profile) renders
 * its own `loading.tsx` that passes a route-appropriate label — so the user
 * never sees a misleading "Loading dashboard…" while, say, the To-review
 * page fetches. The parent `(main)/loading.tsx` uses this with a generic
 * label as the fallback for any nested route without its own loader.
 */
export default function RouteLoading({
  label = "Loading…",
}: {
  label?: string;
}) {
  return (
    <div className="min-h-screen bg-[var(--paper)] dark:bg-zinc-950">
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
        <PageSpinner label={label} />
      </main>
    </div>
  );
}
