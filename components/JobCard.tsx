import { formatDate } from "@/lib/dateUtils";
import Link from "next/link";

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  posted_date: string | null;
  url: string;
  short_description: string | null;
  keyword: string | null;
  scraped_date: string | null;
  responsibilities: string[] | null;
  requirements: string[] | null;
  benefits: string[] | null;
  skills: string[] | null;
  employment_type: string | null;
  experience_level: string | null;
  about_company: string | null;
  raw_description: string | null;
  fit: boolean;
  fit_score: number | null;
  fit_reasons: string[] | null;
  cover_letter: string | null;
  expected_salary: string | null;
  search_key: string | null;
  created_at: string;
  applied?: boolean | null;
};

type JobSource = {
  name: string;
  shortName: string;
  color: string;
  bgColor: string;
  borderColor: string;
};

function detectSource(url: string): JobSource {
  if (url.includes("jobsdb.com")) {
    return {
      name: "JobsDB",
      shortName: "JobsDB",
      color: "text-purple-700 dark:text-purple-300",
      bgColor: "bg-purple-50 dark:bg-purple-950",
      borderColor: "border-purple-200 dark:border-purple-800",
    };
  }
  if (url.includes("indeed.com")) {
    return {
      name: "Indeed",
      shortName: "Indeed",
      color: "text-sky-700 dark:text-sky-300",
      bgColor: "bg-sky-50 dark:bg-sky-950",
      borderColor: "border-sky-200 dark:border-sky-800",
    };
  }
  if (url.includes("ctgoodjobs.hk")) {
    return {
      name: "CTgoodjobs",
      shortName: "CTgoodjobs",
      color: "text-orange-700 dark:text-orange-300",
      bgColor: "bg-orange-50 dark:bg-orange-950",
      borderColor: "border-orange-200 dark:border-orange-800",
    };
  }
  return {
    name: "Job Board",
    shortName: "Job Board",
    color: "text-zinc-700 dark:text-zinc-300",
    bgColor: "bg-zinc-50 dark:bg-zinc-800",
    borderColor: "border-zinc-200 dark:border-zinc-700",
  };
}

function formatSearchKey(key: string | null): string {
  if (!key) return "";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 65
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : score >= 45
        ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-red-100 text-red-800 border-red-200";
  return (
    <span
      className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${color}`}
    >
      {score} / 100
    </span>
  );
}

export default function JobCard({ job }: { job: Job }) {
  const parsedSkills: string[] =
    typeof job.skills === "string"
      ? JSON.parse(job.skills)
      : (job.skills ?? []);

  const source = detectSource(job.url);

  return (
    <div className="relative bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm hover:shadow-md transition-shadow flex flex-col h-130 cursor-pointer group">
      {/* Stretched link — entire card navigates to detail page */}
      <Link
        href={`/jobs/${job.id}`}
        className="absolute inset-0 rounded-2xl z-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        aria-label={`View details for ${job.title} at ${job.company}`}
      />

      {/* Card body */}
      <div className="flex-1 overflow-hidden p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Source + search key row */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${source.color} ${source.bgColor} ${source.borderColor}`}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"
                  />
                </svg>
                {source.shortName}
              </span>
              {job.search_key && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800">
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  {formatSearchKey(job.search_key)}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 leading-snug line-clamp-2 transition-colors">
              {job.title}
            </h2>
            <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              {job.company}
            </p>
          </div>
          <ScoreBadge score={job.fit_score} />
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {job.location && (
            <span className="flex items-center gap-1">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {job.location}
            </span>
          )}
          {job.salary && (
            <span className="flex items-center gap-1">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {job.salary}
            </span>
          )}
          {job.posted_date && (
            <span className="flex items-center gap-1">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {formatDate(job.posted_date)}
            </span>
          )}
          {job.employment_type && (
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5">
              {job.employment_type}
            </span>
          )}
          {job.experience_level && (
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5">
              {job.experience_level}
            </span>
          )}
        </div>

        {/* Short description */}
        {job.short_description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3">
            {job.short_description}
          </p>
        )}

        {/* Skills */}
        {parsedSkills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {parsedSkills.slice(0, 6).map((skill, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900"
              >
                {skill}
              </span>
            ))}
            {parsedSkills.length > 6 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                +{parsedSkills.length - 6} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer — z-10 so links stay above the stretched link */}
      <div className="relative z-10 flex items-center justify-between px-6 py-3 border-t border-zinc-100 dark:border-zinc-800 rounded-b-2xl shrink-0">
        {job.expected_salary ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Expected:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {job.expected_salary}
            </span>
          </span>
        ) : (
          <span />
        )}
        <Link
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          View on {source.shortName}
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </Link>
      </div>
    </div>
  );
}
