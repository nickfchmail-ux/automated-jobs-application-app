/**
 * Suspense fallback for the /matches data region — shown while the fit /
 * not-fit job lists are being fetched. Mirrors the real layout (tab toggle +
 * filter panel + card grid) so there's no jarring layout shift.
 */
export default function MatchesViewFallback() {
  return (
    <div className="space-y-8" role="status" aria-live="polite">
      {/* Tab toggle skeleton */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-9 w-28 rounded-lg bg-[var(--paper-soft)] animate-pulse"
          />
        ))}
      </div>

      {/* Filter panel skeleton */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 shadow-sm space-y-3">
        <div className="h-8 w-full rounded-lg bg-[var(--paper-soft)] animate-pulse" />
        <div className="h-8 w-full rounded-lg bg-[var(--paper-soft)] animate-pulse" />
        <div className="h-8 w-full rounded-lg bg-[var(--paper-soft)] animate-pulse" />
      </div>

      {/* Card grid skeleton */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex gap-1.5">
                  <div className="h-5 w-16 rounded-full bg-[var(--paper-soft)] animate-pulse" />
                  <div className="h-5 w-12 rounded-full bg-[var(--paper-soft)] animate-pulse" />
                </div>
                <div className="h-5 w-3/4 rounded-lg bg-[var(--paper-soft)] animate-pulse" />
                <div className="h-4 w-1/2 rounded-lg bg-[var(--paper-soft)] animate-pulse" />
              </div>
              <div className="h-6 w-16 rounded-full bg-[var(--paper-soft)] animate-pulse" />
            </div>
            <div className="flex gap-2">
              <div className="h-4 w-20 rounded-full bg-[var(--paper-soft)] animate-pulse" />
              <div className="h-4 w-24 rounded-full bg-[var(--paper-soft)] animate-pulse" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3].map((s) => (
                <div
                  key={s}
                  className="h-5 w-14 rounded-full bg-[var(--paper-soft)] animate-pulse"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
