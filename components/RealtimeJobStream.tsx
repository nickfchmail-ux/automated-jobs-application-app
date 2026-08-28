"use client";

import FitBadge from "@/components/FitBadge";
import ResumeStatusBadge from "@/components/ResumeStatusBadge";
import { jobStatusCopy } from "@/lib/funnel";
import type { LiveJobRow } from "@/state/global/slice/runSlice";
import type { JobRowStatus, ResumeStatus } from "@/types/api";
import Link from "next/link";
import { useMemo } from "react";

/** Lifecycle buckets — the logical order the user sees jobs move through:
 *  Found → Reading the ad → Saved → Scored ✓ (and failures). */
type LifecycleBucket =
  | "found"
  | "reading"
  | "saved"
  | "scored"
  | "failed"
  | "duplicate";

const BUCKET_ORDER: LifecycleBucket[] = [
  "found",
  "reading",
  "saved",
  "scored",
  "failed",
  "duplicate",
];

/** Map a job's machine status to a lifecycle bucket. */
function bucketOfStatus(status: string | null | undefined): LifecycleBucket {
  switch (status) {
    case "discovered":
    case "queued":
      return "found";
    case "scraping":
    case "processing":
    case "enriching":
      return "reading";
    case "analysing":
    case "analysed":
      return "scored";
    case "completed":
      return "saved";
    case "failed":
      return "failed";
    case "duplicate":
      return "duplicate";
    default:
      return "found";
  }
}

const BUCKET_META: Record<
  LifecycleBucket,
  { title: string; tone: "neutral" | "active" | "success" | "error" | "muted" }
> = {
  found: { title: "Found", tone: "neutral" },
  reading: { title: "Reading the full ad…", tone: "active" },
  saved: { title: "Saved", tone: "success" },
  scored: { title: "Scored", tone: "success" },
  failed: { title: "Failed", tone: "error" },
  duplicate: { title: "Already saved", tone: "muted" },
};

function jobRowToJob(row: LiveJobRow) {
  return {
    id: row.id,
    title: row.title ?? "Untitled role",
    company: row.company ?? "Unknown company",
    location: row.location,
    salary: row.salary,
    url: row.url,
    fit: row.fit ?? false,
    fit_score: row.fit_score,
    posted_date: row.posted_date,
    status: row.status as JobRowStatus | null,
  };
}

/**
 * The live stream of jobs found this search, grouped by where they are in
 * their lifecycle so the user understands what's happening:
 *
 *   Found → Reading the full ad… → Saved → Scored ✓
 *
 * Rows fade in (300ms) as they land; no motion under prefers-reduced-motion.
 * If many arrive at once they're grouped under their section header rather
 * than animating one-by-one.
 */
export default function RealtimeJobStream({
  jobs,
  total,
}: {
  jobs: LiveJobRow[];
  total: number;
}) {
  const buckets = useMemo(() => {
    const grouped: Record<LifecycleBucket, LiveJobRow[]> = {
      found: [],
      reading: [],
      saved: [],
      scored: [],
      failed: [],
      duplicate: [],
    };
    for (const job of jobs) {
      grouped[bucketOfStatus(job.status)].push(job);
    }
    return grouped;
  }, [jobs]);

  const hasAny = jobs.length > 0 || total > 0;

  if (!hasAny) {
    return (
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">
          Jobs you find will appear here as they come in.
        </p>
      </div>
    );
  }

  const sections: {
    key: LifecycleBucket;
    title: string;
    count: number;
    jobs: LiveJobRow[];
  }[] = BUCKET_ORDER.map((key) => ({
    key,
    title: BUCKET_META[key].title,
    count: buckets[key].length,
    jobs: buckets[key],
  })).filter((s) => s.jobs.length > 0);

  const visibleSections = sections;

  return (
    <div className="space-y-6">
      {/* Section headers with live counts */}
      {visibleSections.map((section) => (
        <section key={section.key} aria-label={section.title}>
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              {section.title}
            </h2>
            <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
              {section.count}
            </span>
          </div>
          <ul className="space-y-2">
            {section.jobs.map((row) => {
              const job = jobRowToJob(row);
              return (
                <li
                  key={row.id}
                  className="job-enter rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {job.title}
                      </p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                        {job.company}
                        {job.salary ? ` · ${job.salary}` : ""}
                        {job.location ? ` · ${job.location}` : ""}
                      </p>
                      {/* Resume build failure (generated_resumes.error / jobs.resume_error) */}
                      {row.resume_error && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          Couldn&apos;t build a resume for this one.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Lifecycle status chip — never color alone */}
                      {job.status && (
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                            BUCKET_META[section.key].tone === "success"
                              ? "text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
                              : BUCKET_META[section.key].tone === "error"
                                ? "text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950"
                                : BUCKET_META[section.key].tone === "active"
                                  ? "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950"
                                  : "text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800"
                          }`}
                        >
                          {jobStatusCopy(job.status).label}
                        </span>
                      )}
                      {section.key === "scored" && job.fit_score !== null && (
                        <FitBadge score={job.fit_score} compact />
                      )}
                      {row.fit &&
                        row.resume_status &&
                        row.resume_status !== "none" && (
                          <ResumeStatusBadge
                            status={row.resume_status as ResumeStatus}
                            resumeUrl={row.resume_url}
                            resumePdfUrl={row.resume_pdf_url}
                          />
                        )}
                      {job.url && (
                        <Link
                          href={`/jobs/${row.id}`}
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View →
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Batching calm: a quiet total line rather than animating dozens of cards */}
      {jobs.length === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {total} new {total === 1 ? "job" : "jobs"} from this search — the list
          will fill in as they stream in.
        </p>
      ) : (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {total > jobs.length
            ? `${jobs.length} shown of ${total} new — keep scrolling for more`
            : `${jobs.length} new ${jobs.length === 1 ? "job" : "jobs"} this search`}
        </p>
      )}
    </div>
  );
}
