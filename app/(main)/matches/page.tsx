import PageHeader from "@/components/PageHeader";
import { getUserId } from "@/lib/auth";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import MatchesViewFallback from "./_fallback";
import MatchesView from "./_view";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Matches",
};

/**
 * /matches — every evaluated job, in one place.
 *
 * A unified view of the AI's verdicts with a Good fit / Not a fit toggle,
 * plus the reasons behind each score. Replaces the old separate /fit and
 * /not-fit pages with one coherent results surface.
 *
 * The page SHELL (header + footer) renders immediately; only the
 * data-dependent region (tab counts + job lists, fetched from Supabase) is
 * wrapped in <Suspense> with a matching skeleton — so navigating here never
 * blocks the whole route on the backend query.
 *
 * `?view=notfit` deep-links to the not-fit tab (old /not-fit redirects here).
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const active = view === "notfit" ? "notfit" : "fit";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <PageHeader
        eyebrow="Results"
        title="Matches"
        subtitle="Every job the AI has scored against your resume — the strong fits to act on, and the near-misses worth understanding."
      />

      {/* Data region — suspends on the Supabase queries, shell paints first */}
      <Suspense fallback={<MatchesViewFallback />}>
        <MatchesView userId={userId} active={active} />
      </Suspense>

      <p className="text-sm text-[var(--ink-faint)]">
        Want the big picture?{" "}
        <Link
          href="/overview"
          className="font-medium text-[var(--accent-ink)] hover:underline"
        >
          View your insights →
        </Link>
      </p>
    </div>
  );
}
