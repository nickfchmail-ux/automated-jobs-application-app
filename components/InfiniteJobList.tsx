"use client";

import JobCard, { Job } from "@/components/JobCard";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

function detectSourceName(url: string): string {
  if (url.includes("jobsdb.com")) return "JobsDB";
  if (url.includes("indeed.com")) return "Indeed";
  if (url.includes("ctgoodjobs.hk")) return "CTgoodjobs";
  if (url.includes("offertoday.com")) return "OfferToday";
  if (url.includes("glassdoor.com")) return "Glassdoor";
  return "Other";
}

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type FilterBarProps = {
  label: string;
  options: string[];
  active: string;
  onChange: (v: string) => void;
  colorMap?: Record<string, string>;
};

function FilterBar({
  label,
  options,
  active,
  onChange,
  colorMap,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider shrink-0">
        {label}
      </span>
      <motion.button
        onClick={() => onChange("All")}
        aria-pressed={active === "All"}
        whileTap={{ scale: 0.95 }}
        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
          active === "All"
            ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
            : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
        }`}
      >
        All
      </motion.button>
      {options.map((opt) => {
        const isActive = active === opt;
        const custom = colorMap?.[opt];
        return (
          <motion.button
            key={opt}
            onClick={() => onChange(opt)}
            aria-pressed={isActive}
            whileTap={{ scale: 0.95 }}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              isActive
                ? custom
                  ? `${custom} border-transparent`
                  : "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
            }`}
          >
            {opt}
          </motion.button>
        );
      })}
    </div>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  JobsDB: "bg-purple-600 text-white dark:bg-purple-500",
  Indeed: "bg-sky-600 text-white dark:bg-sky-500",
  CTgoodjobs: "bg-orange-500 text-white",
  OfferToday: "bg-teal-600 text-white dark:bg-teal-500",
  Glassdoor: "bg-green-600 text-white dark:bg-green-500",
  Other: "bg-zinc-600 text-white",
};

type FilterBreakdownEntry = {
  source: string;
  searchKey: string;
  applied: boolean;
  count: number;
};

type PageData = {
  jobs: Job[];
  nextCursor: number | null;
  total: number;
  filterOptions: { sources: string[]; searchKeys: string[] };
  filterBreakdown: FilterBreakdownEntry[];
};

interface InfiniteJobListProps {
  queryKey: string;
  apiUrl: string;
  emptyMessage: string;
  emptyIcon?: React.ReactNode;
}

export default function InfiniteJobList({
  queryKey,
  apiUrl,
  emptyMessage,
  emptyIcon,
}: InfiniteJobListProps) {
  const [sourceFilter, setSourceFilter] = useState("All");
  const [keyFilter, setKeyFilter] = useState("All");
  const [appliedFilter, setAppliedFilter] = useState("All");

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery<PageData>({
    queryKey: [queryKey],
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`${apiUrl}?cursor=${pageParam}`);
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error("Session expired. Please refresh the page.");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch jobs");
      }
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const sentinelRef = useRef<HTMLDivElement>(null);

  const allJobs = useMemo(
    () => data?.pages.flatMap((p) => p.jobs) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;
  const filterOptions = data?.pages[0]?.filterOptions;
  const filterBreakdown = data?.pages[0]?.filterBreakdown ?? [];

  const isFiltering =
    sourceFilter !== "All" || keyFilter !== "All" || appliedFilter !== "All";

  // Compute exact filtered total from the server-provided breakdown
  const filteredTotal = useMemo(() => {
    if (!isFiltering) return total;
    return filterBreakdown.reduce((sum, entry) => {
      const matchSource =
        sourceFilter === "All" || entry.source === sourceFilter;
      const matchKey = keyFilter === "All" || entry.searchKey === keyFilter;
      const matchApplied =
        appliedFilter === "All" ||
        (appliedFilter === "Applied" && entry.applied) ||
        (appliedFilter === "Not Applied" && !entry.applied);
      return matchSource && matchKey && matchApplied ? sum + entry.count : sum;
    }, 0);
  }, [
    filterBreakdown,
    sourceFilter,
    keyFilter,
    appliedFilter,
    isFiltering,
    total,
  ]);

  // Client-side filtering on already-loaded data (no refetch)
  const filtered = useMemo(() => {
    return allJobs.filter((job) => {
      const matchSource =
        sourceFilter === "All" || detectSourceName(job.url) === sourceFilter;
      const matchKey =
        keyFilter === "All" ||
        formatKey(job.search_key ?? "Unknown") === keyFilter;
      const matchApplied =
        appliedFilter === "All" ||
        (appliedFilter === "Applied" && job.applied === true) ||
        (appliedFilter === "Not Applied" && !job.applied);
      return matchSource && matchKey && matchApplied;
    });
  }, [allJobs, sourceFilter, keyFilter, appliedFilter]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage &&
          filtered.length > 0
        ) {
          fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, filtered.length]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-4 border-zinc-300 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 px-5 py-4 text-red-700 dark:text-red-300 mb-6">
        <strong>Error:</strong> {(error as Error).message}
      </div>
    );
  }

  if (total === 0 && allJobs.length === 0) {
    return (
      <div className="text-center py-20 text-zinc-400 dark:text-zinc-500">
        {emptyIcon ?? (
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
        )}
        <p className="text-lg font-medium">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Filter panel */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 shadow-sm space-y-3">
        <FilterBar
          label="Search Key"
          options={filterOptions?.searchKeys ?? []}
          active={keyFilter}
          onChange={setKeyFilter}
        />
        <div className="border-t border-zinc-100 dark:border-zinc-800" />
        <FilterBar
          label="Applied"
          options={["Not Applied", "Applied"]}
          active={appliedFilter}
          onChange={setAppliedFilter}
          colorMap={{
            Applied: "bg-emerald-600 text-white",
            "Not Applied": "bg-zinc-600 text-white",
          }}
        />
        <div className="border-t border-zinc-100 dark:border-zinc-800" />
        <FilterBar
          label="Source"
          options={filterOptions?.sources ?? []}
          active={sourceFilter}
          onChange={setSourceFilter}
          colorMap={SOURCE_COLORS}
        />
      </div>

      {/* Result count */}
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {isFiltering ? (
          <>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {filtered.length}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {filteredTotal}
            </span>{" "}
            job{filteredTotal !== 1 ? "s" : ""}
            {sourceFilter !== "All" && (
              <span className="ml-1">
                from <strong>{sourceFilter}</strong>
              </span>
            )}
            {keyFilter !== "All" && (
              <span className="ml-1">
                · search key <strong>{keyFilter}</strong>
              </span>
            )}
          </>
        ) : (
          <>
            Showing{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {allJobs.length}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">
              {total}
            </span>{" "}
            job{total !== 1 ? "s" : ""}
          </>
        )}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-zinc-400 dark:text-zinc-500">
          <svg
            className="w-10 h-10 mx-auto mb-3 opacity-40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p className="text-base font-medium">No jobs match this filter</p>
          <p className="text-sm mt-1">Try selecting a different combination.</p>
        </div>
      ) : (
        <motion.div layout className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />
      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <div className="w-6 h-6 border-3 border-zinc-300 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-400 rounded-full animate-spin" />
        </div>
      )}
      {hasNextPage && !isFetchingNextPage && (
        <button
          onClick={() => fetchNextPage()}
          className="mx-auto block text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Load more
        </button>
      )}
      {!hasNextPage && allJobs.length > 0 && !isFiltering && (
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-600 pb-4">
          All {total} jobs loaded
        </p>
      )}
    </div>
  );
}
