import FitFilters from "@/components/FitFilters";
import type { JobListItem } from "@/components/JobCard";
import PageHeader from "@/components/PageHeader";
import { getUserId } from "@/lib/auth";
import { JOBS_LIST_SELECT } from "@/lib/data-services";
import { supabase } from "@/lib/supabase";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "To Review",
};

/**
 * /review — scraped jobs that haven't been scored by the AI yet.
 *
 * These are the "raw" listings waiting for a match run. Once evaluated they
 * move to /matches. Replaces the old /not-evaluated page.
 */
export default async function ReviewPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let jobs: JobListItem[] = [];
  try {
    const result = await supabase
      .from("jobs")
      // Projected list columns — not `select("*")` (heavy columns like
      // raw_description/cover_letter are detail-page-only; fetching them on
      // every review load was a Supabase exhaustor).
      .select(JOBS_LIST_SELECT)
      .eq("user_id", userId)
      .is("fit_score", null)
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("[ReviewPage] Supabase query error:", result.error);
    } else {
      jobs = (result.data as JobListItem[]) ?? [];
    }
  } catch (err) {
    console.error("[ReviewPage] Unexpected error fetching jobs:", err);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <PageHeader
        eyebrow="Review"
        title="To review"
        subtitle="Jobs scraped but not yet scored. Run a match to get the AI's verdict on each one."
      />

      <FitFilters
        jobs={jobs}
        emptyMessage="Nothing waiting — everything has been scored, or you haven't searched yet. Start a search to bring jobs in."
      />

      <p className="text-sm text-[var(--ink-faint)]">
        Ready to score these?{" "}
        <Link
          href="/search"
          className="font-medium text-[var(--accent-ink)] hover:underline"
        >
          Run a match →
        </Link>
      </p>
    </div>
  );
}
