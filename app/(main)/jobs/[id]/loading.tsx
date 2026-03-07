import PageSpinner from "@/components/PageSpinner";

export default function JobDetailLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Navbar placeholder */}
      <div className="h-14 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800" />

      {/* Header skeleton */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
          <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-700 rounded-full mb-5 animate-pulse" />
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex gap-2">
                <div className="h-5 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-full animate-pulse" />
                <div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-700 rounded-full animate-pulse" />
              </div>
              <div className="h-8 w-3/4 bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
              <div className="h-4 w-1/2 bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
            </div>
            <div className="flex gap-3">
              <div className="h-8 w-28 bg-zinc-200 dark:bg-zinc-700 rounded-full animate-pulse" />
              <div className="h-9 w-32 bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse" />
            </div>
          </div>
          <div className="flex gap-4 mt-4">
            {[60, 80, 48].map((w, i) => (
              <div
                key={i}
                className={`h-4 w-${w} bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Content skeleton */}
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
            <div className="h-3 w-24 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse mb-3" />
            <div className="flex flex-wrap gap-1.5">
              {[48, 56, 40, 64, 44].map((w, i) => (
                <div
                  key={i}
                  className={`h-6 w-${w} bg-zinc-200 dark:bg-zinc-700 rounded-full animate-pulse`}
                />
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
            <div className="h-3 w-32 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse mb-3" />
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-3 w-full bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse"
                />
              ))}
            </div>
          </div>
        </div>

        {/* Main column */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-3"
            >
              <div className="h-3 w-28 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
              {[100, 90, 95, 80].map((w, j) => (
                <div
                  key={j}
                  className={`h-3 w-[${w}%] bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse`}
                />
              ))}
            </div>
          ))}
          <PageSpinner label="Loading job details…" />
        </div>
      </div>
    </div>
  );
}
