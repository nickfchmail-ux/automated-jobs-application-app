import FitFilters from "@/components/FitFilters";
import type { Job } from "@/components/JobCard";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

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

  let fitJobs: Job[] = [];
  let notFitJobs: Job[] = [];
  try {
    const [fit, notFit] = await Promise.all([
      supabase
        .from("jobs")
        .select("*")
        .eq("fit", true)
        .eq("user_id", userId)
        .or("interested_in.is.null,interested_in.eq.true"),
      supabase
        .from("jobs")
        .select("*")
        .eq("fit", false)
        .eq("user_id", userId)
        .or("interested_in.is.null,interested_in.eq.true"),
    ]);
    if (fit.error) console.error("[Matches] fit error:", fit.error);
    if (notFit.error) console.error("[Matches] notFit error:", notFit.error);
    fitJobs = (fit.data as Job[]) ?? [];
    notFitJobs = (notFit.data as Job[]) ?? [];
  } catch (e) {
    console.error("[Matches] error:", e);
  }

  const tabs = [
    { key: "fit", label: "Good fit", count: fitJobs.length, href: "/matches" },
    {
      key: "notfit",
      label: "Not a fit",
      count: notFitJobs.length,
      href: "/matches?view=notfit",
    },
  ] as const;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <header>
        <p className="eyebrow">Results</p>
        <h1 className="mt-2 text-3xl font-display font-semibold tracking-tight text-[var(--ink)]">
          Matches
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)] max-w-xl">
          Every job the AI has scored against your resume — the strong fits to
          act on, and the near-misses worth understanding.
        </p>
      </header>

      {/* Toggle */}
      <div
        role="tablist"
        aria-label="Filter by fit"
        className="inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            href={t.href}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 ${
              active === t.key
                ? t.key === "fit"
                  ? "bg-[var(--good)] text-white"
                  : "bg-[var(--bad)] text-white"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--paper-soft)]"
            }`}
          >
            {t.label}
            <span className="font-data text-xs tabular-nums opacity-80">
              {t.count}
            </span>
          </Link>
        ))}
      </div>

      {active === "fit" ? (
        <FitFilters
          jobs={fitJobs}
          emptyMessage="No good-fit jobs yet — run a search and match it against your resume."
        />
      ) : (
        <FitFilters jobs={notFitJobs} emptyMessage="No not-fit jobs yet." />
      )}

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
