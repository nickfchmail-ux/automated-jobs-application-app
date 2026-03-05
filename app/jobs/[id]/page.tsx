import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import Navbar from "@/components/Navbar";
import { getUserId } from "@/lib/auth";
import { formatDate } from "@/lib/dateUtils";
import { supabase } from "@/lib/supabase";
import AppliedToggle from "./AppliedToggle";
import CoverLetterActions from "./CoverLetterActions";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data: job } = await supabase
    .from("jobs")
    .select("title, company")
    .eq("id", id)
    .single();

  if (!job) return { title: "Job Detail" };
  return { title: `${job.title} — ${job.company}` };
}

type JobSource = {
  name: string;
  shortName: string;
  color: string;
  bgColor: string;
  borderColor: string;
};

function detectSource(url: string): JobSource {
  if (url.includes("jobsdb.com"))
    return {
      name: "JobsDB",
      shortName: "JobsDB",
      color: "text-purple-700 dark:text-purple-300",
      bgColor: "bg-purple-50 dark:bg-purple-950",
      borderColor: "border-purple-200 dark:border-purple-800",
    };
  if (url.includes("indeed.com"))
    return {
      name: "Indeed",
      shortName: "Indeed",
      color: "text-sky-700 dark:text-sky-300",
      bgColor: "bg-sky-50 dark:bg-sky-950",
      borderColor: "border-sky-200 dark:border-sky-800",
    };
  if (url.includes("ctgoodjobs.hk"))
    return {
      name: "CTgoodjobs",
      shortName: "CTgoodjobs",
      color: "text-orange-700 dark:text-orange-300",
      bgColor: "bg-orange-50 dark:bg-orange-950",
      borderColor: "border-orange-200 dark:border-orange-800",
    };
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
      ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
      : score >= 45
        ? "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
        : "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800";
  return (
    <span
      className={`text-sm font-semibold px-3 py-1.5 rounded-full border ${color}`}
    >
      Fit Score: {score} / 100
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
      {children}
    </h2>
  );
}

function BulletList({
  items,
  icon,
}: {
  items: string[];
  icon?: React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-2.5 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <span className="mt-0.5 shrink-0 text-zinc-400">{icon ?? "•"}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error || !job) notFound();

  const source = detectSource(job.url);

  const parsedReasons: string[] =
    typeof job.fit_reasons === "string"
      ? JSON.parse(job.fit_reasons)
      : (job.fit_reasons ?? []);

  const parsedSkills: string[] =
    typeof job.skills === "string"
      ? JSON.parse(job.skills)
      : (job.skills ?? []);

  const parsedResponsibilities: string[] =
    typeof job.responsibilities === "string"
      ? JSON.parse(job.responsibilities)
      : (job.responsibilities ?? []);

  const parsedRequirements: string[] =
    typeof job.requirements === "string"
      ? JSON.parse(job.requirements)
      : (job.requirements ?? []);

  const parsedBenefits: string[] =
    typeof job.benefits === "string"
      ? JSON.parse(job.benefits)
      : (job.benefits ?? []);

  const backHref = job.fit ? "/fit" : "/not-fit";
  const backLabel = job.fit ? "Good Fit Jobs" : "Not Fit Jobs";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Navbar currentPath={job.fit ? "/fit" : "/not-fit"} />

      {/* Page header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6">
          {/* Back navigation */}
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors mb-5"
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
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to {backLabel}
          </Link>

          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${source.color} ${source.bgColor} ${source.borderColor}`}
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
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800">
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
                {job.fit ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800">
                    ✓ Good Fit
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800">
                    ✗ Not a Fit
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-50 leading-snug">
                {job.title}
              </h1>
              <p className="mt-1 text-base font-medium text-zinc-600 dark:text-zinc-400">
                {job.company}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <ScoreBadge score={job.fit_score} />
              <AppliedToggle
                jobId={job.id}
                initialApplied={job.applied ?? false}
              />
              <Link
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                View on {source.shortName}
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
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </Link>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap gap-4 mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            {job.location && (
              <span className="flex items-center gap-1.5">
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
              <span className="flex items-center gap-1.5">
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
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {job.salary}
              </span>
            )}
            {job.expected_salary && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
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
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Expected: {job.expected_salary}
              </span>
            )}
            {job.posted_date && (
              <span className="flex items-center gap-1.5">
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
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {formatDate(job.posted_date)}
              </span>
            )}
            {job.employment_type && (
              <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-0.5 text-xs font-medium">
                {job.employment_type}
              </span>
            )}
            {job.experience_level && (
              <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-0.5 text-xs font-medium">
                {job.experience_level}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-10 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left sidebar */}
        <aside className="flex flex-col gap-6">
          {/* Skills */}
          {parsedSkills.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
              <SectionHeading>Skills Required</SectionHeading>
              <div className="flex flex-wrap gap-1.5">
                {parsedSkills.map((skill, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* About company */}
          {job.about_company && (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
              <SectionHeading>About the Company</SectionHeading>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                {job.about_company}
              </p>
            </div>
          )}

          {/* Scraped date */}
          {job.scraped_date && (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 text-center">
              Scraped {formatDate(job.scraped_date)}
            </p>
          )}
        </aside>

        {/* Main column */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          {/* Short description */}
          {job.short_description && (
            <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <SectionHeading>Job Summary</SectionHeading>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {job.short_description}
              </p>
            </section>
          )}

          {/* Responsibilities */}
          {parsedResponsibilities.length > 0 && (
            <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <SectionHeading>Responsibilities</SectionHeading>
              <BulletList items={parsedResponsibilities} />
            </section>
          )}

          {/* Requirements */}
          {parsedRequirements.length > 0 && (
            <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <SectionHeading>Requirements</SectionHeading>
              <BulletList items={parsedRequirements} />
            </section>
          )}

          {/* Benefits */}
          {parsedBenefits.length > 0 && (
            <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
              <SectionHeading>Benefits</SectionHeading>
              <BulletList
                items={parsedBenefits}
                icon={
                  <svg
                    className="w-4 h-4 text-emerald-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                }
              />
            </section>
          )}

          {/* Why it's a (good/bad) fit */}
          {parsedReasons.length > 0 && (
            <section
              className={`rounded-2xl border p-6 ${
                job.fit
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50"
                  : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50"
              }`}
            >
              <SectionHeading>
                {job.fit ? "Why it's a good fit" : "Why it doesn't fit"}
              </SectionHeading>
              <ul className="space-y-3">
                {parsedReasons.map((reason, i) => (
                  <li
                    key={i}
                    className="flex gap-3 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <span
                      className={`mt-0.5 shrink-0 text-base leading-none ${job.fit ? "text-emerald-500" : "text-red-400"}`}
                    >
                      {job.fit ? "✓" : "✗"}
                    </span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Cover letter */}
          {job.cover_letter && (
            <CoverLetterActions
              letter={job.cover_letter}
              title={job.title}
              company={job.company}
            />
          )}
        </div>
      </main>
    </div>
  );
}
