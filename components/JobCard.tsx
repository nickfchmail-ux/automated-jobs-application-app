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
  fit: boolean;
  fit_score: number | null;
  fit_reasons: string[] | null;
  cover_letter: string | null;
  expected_salary: string | null;
  created_at: string;
};

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
  const parsedReasons: string[] =
    typeof job.fit_reasons === "string"
      ? JSON.parse(job.fit_reasons)
      : (job.fit_reasons ?? []);

  const parsedSkills: string[] =
    typeof job.skills === "string"
      ? JSON.parse(job.skills)
      : (job.skills ?? []);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Link
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-bold text-zinc-900 dark:text-zinc-50 hover:text-blue-600 dark:hover:text-blue-400 leading-snug line-clamp-2 transition-colors"
          >
            {job.title}
          </Link>
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
            {job.posted_date}
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
        <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">
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

      {/* Fit reasons */}
      {parsedReasons.length > 0 && (
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-700/50 p-4">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            {job.fit ? "Why it's a good fit" : "Why it doesn't fit"}
          </p>
          <ul className="space-y-1.5">
            {parsedReasons.map((reason, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300"
              >
                <span
                  className={`mt-0.5 shrink-0 ${job.fit ? "text-emerald-500" : "text-red-400"}`}
                >
                  {job.fit ? "✓" : "✗"}
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cover letter snippet */}
      {job.cover_letter && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline list-none flex items-center gap-1 select-none">
            <svg
              className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
            View cover letter
          </summary>
          <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap leading-relaxed border-l-2 border-blue-200 dark:border-blue-800 pl-4">
            {job.cover_letter}
          </div>
        </details>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
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
          View on JobsDB
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
