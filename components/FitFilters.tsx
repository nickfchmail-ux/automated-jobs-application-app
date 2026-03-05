"use client";

import JobCard, { Job } from "@/components/JobCard";
import { useMemo, useState } from "react";

function detectSourceName(url: string): string {
  if (url.includes("jobsdb.com")) return "JobsDB";
  if (url.includes("indeed.com")) return "Indeed";
  if (url.includes("ctgoodjobs.hk")) return "CTgoodjobs";
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
      <button
        onClick={() => onChange("All")}
        className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
          active === "All"
            ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
            : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
        }`}
      >
        All
      </button>
      {options.map((opt) => {
        const isActive = active === opt;
        const custom = colorMap?.[opt];
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              isActive
                ? custom
                  ? `${custom} border-transparent`
                  : "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-transparent"
                : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  JobsDB: "bg-purple-600 text-white dark:bg-purple-500",
  Indeed: "bg-sky-600 text-white dark:bg-sky-500",
  CTgoodjobs: "bg-orange-500 text-white",
  Other: "bg-zinc-600 text-white",
};

export default function FitFilters({ jobs }: { jobs: Job[] }) {
  const [sourceFilter, setSourceFilter] = useState("All");
  const [keyFilter, setKeyFilter] = useState("All");
  const [appliedFilter, setAppliedFilter] = useState("All");

  const sources = useMemo(
    () => [...new Set(jobs.map((j) => detectSourceName(j.url)))].sort(),
    [jobs],
  );

  const searchKeys = useMemo(
    () =>
      [...new Set(jobs.map((j) => j.search_key ?? "Unknown"))]
        .sort()
        .map((k) => formatKey(k)),
    [jobs],
  );

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
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
  }, [jobs, sourceFilter, keyFilter, appliedFilter]);

  return (
    <div className="space-y-8">
      {/* Filter panel */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 shadow-sm space-y-3">
        <FilterBar
          label="Source"
          options={sources}
          active={sourceFilter}
          onChange={setSourceFilter}
          colorMap={SOURCE_COLORS}
        />
        <div className="border-t border-zinc-100 dark:border-zinc-800" />
        <FilterBar
          label="Search Key"
          options={searchKeys}
          active={keyFilter}
          onChange={setKeyFilter}
        />
        <div className="border-t border-zinc-100 dark:border-zinc-800" />
        <FilterBar
          label="Applied"
          options={["Applied", "Not Applied"]}
          active={appliedFilter}
          onChange={setAppliedFilter}
          colorMap={{
            Applied: "bg-emerald-600 text-white",
            "Not Applied": "bg-zinc-600 text-white",
          }}
        />
      </div>

      {/* Result count */}
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
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
