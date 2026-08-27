"use client";

import JobCard, { Job, JobListItem } from "@/components/JobCard";
import { computeActualPostedTimestamp, formatDate } from "@/lib/dateUtils";
import {
  saveMatchesScrollPosition,
  useMatchesScrollRestore,
} from "@/hooks/useMatchesScrollRestore";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

function detectSourceName(url: string): string {
  if (url.includes("jobsdb.com")) return "JobsDB";
  if (url.includes("indeed.com")) return "Indeed";
  if (url.includes("ctgoodjobs.hk")) return "CTgoodjobs";
  if (url.includes("linkedin.com")) return "LinkedIn";
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
        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
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
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
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

interface FitFiltersProps {
  jobs: (Job | JobListItem)[];
  emptyMessage: string;
  emptyIcon?: React.ReactNode;
}

export default function FitFilters({
  jobs,
  emptyMessage,
  emptyIcon,
}: FitFiltersProps) {
  const router = useRouter();
  const [sourceFilter, setSourceFilter] = useState("All");
  const [keyFilter, setKeyFilter] = useState("All");
  const [appliedFilter, setAppliedFilter] = useState("Not Applied");
  // View mode (table vs card). Persisted to localStorage so the user's choice
  // survives navigating to a job and back (without this, the component
  // remounts and resets to the width default — desktop flips back to table).
  const [viewMode, setViewMode] = useState<"table" | "card">(() => {
    if (typeof window === "undefined") return "table";
    try {
      const saved = localStorage.getItem("jobseek:matches-view");
      if (saved === "card" || saved === "table") return saved;
    } catch {
      // non-fatal
    }
    // First visit: default by screen width (mobile → cards, desktop → table).
    return window.innerWidth < 768 ? "card" : "table";
  });

  const changeViewMode = (mode: "table" | "card") => {
    setViewMode(mode);
    try {
      localStorage.setItem("jobseek:matches-view", mode);
    } catch {
      // non-fatal
    }
  };

  // Restore the saved scroll position when returning from a job detail page.
  useMatchesScrollRestore();

  const sorted = useMemo(
    () =>
      [...jobs].sort((a, b) => {
        // Primary: fit score (highest first). Jobs without a score sort last.
        const sa = a.fit_score ?? -1;
        const sb = b.fit_score ?? -1;
        if (sa !== sb) return sb - sa;
        // Secondary: post date (newest first).
        return (
          computeActualPostedTimestamp(b.posted_date, b.scraped_date) -
          computeActualPostedTimestamp(a.posted_date, a.scraped_date)
        );
      }),
    [jobs],
  );

  const sources = useMemo(
    () => [...new Set(sorted.map((j) => detectSourceName(j.url)))].sort(),
    [sorted],
  );

  const searchKeys = useMemo(
    () =>
      [...new Set(sorted.map((j) => j.search_key ?? "Unknown"))]
        .sort()
        .map((k) => formatKey(k)),
    [sorted],
  );

  const filtered = useMemo(() => {
    return sorted.filter((job) => {
      const matchSource =
        sourceFilter === "All" || detectSourceName(job.url) === sourceFilter;
      const matchKey =
        keyFilter === "All" ||
        formatKey(job.search_key ?? "Unknown") === keyFilter;
      const matchApplied =
        appliedFilter === "All" ||
        (appliedFilter === "Applied" && job.applied === true) ||
        (appliedFilter === "Not Applied" && !job.applied);
      return matchApplied && matchSource && matchKey;
    });
  }, [sorted, sourceFilter, keyFilter, appliedFilter]);

  if (jobs.length === 0) {
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
          options={searchKeys}
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
          options={sources}
          active={sourceFilter}
          onChange={setSourceFilter}
          colorMap={SOURCE_COLORS}
        />
      </div>

      {/* Result count + view toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Showing{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            {filtered.length}
          </span>{" "}
          of{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">
            {jobs.length}
          </span>{" "}
          job{jobs.length !== 1 ? "s" : ""}
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
        </p>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5">
          <button
            onClick={() => changeViewMode("table")}
            aria-pressed={viewMode === "table"}
            className={`p-1.5 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${viewMode === "table" ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
            aria-label="Table view"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 10h16M4 14h16M4 18h16"
              />
            </svg>
          </button>
          <button
            onClick={() => changeViewMode("card")}
            aria-pressed={viewMode === "card"}
            className={`p-1.5 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${viewMode === "card" ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}
            aria-label="Card view"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Grid / Table */}
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
      ) : viewMode === "card" ? (
        <motion.div layout className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((job) => (
              <JobCard key={job.id} job={job} backHref="/matches" />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-x-auto shadow-sm">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Title
                </th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Company
                </th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Location
                </th>
                <th className="text-center px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Score
                </th>
                <th className="text-center px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Applied
                </th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Applied On
                </th>
                <th className="text-left px-4 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                  Posted
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => {
                    saveMatchesScrollPosition();
                    router.push(`/jobs/${job.id}?from=/matches`);
                  }}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1">
                      {job.title}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {job.company}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-500 truncate max-w-50">
                    {job.location}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {job.fit_score !== null && (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          job.fit_score >= 65
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : job.fit_score >= 45
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                              : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        }`}
                      >
                        {job.fit_score}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        job.applied
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {job.applied ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-500 whitespace-nowrap">
                    {job.applied_on ? formatDate(job.applied_on) : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-500 whitespace-nowrap">
                    {formatDate(job.posted_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
