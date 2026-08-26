import FitFilters from "@/components/FitFilters";
import type { Job } from "@/components/JobCard";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type MatchesViewProps = {
  userId: string;
  active: "fit" | "notfit";
};

/**
 * The data-dependent half of /matches — fetched lazily inside a <Suspense>
 * boundary so the page shell (header) paints immediately.
 *
 * Loads BOTH fit and not-fit jobs in parallel (so the tab counts are always
 * accurate regardless of which tab is active), then renders the tab toggle +
 * the filtered job list.
 */
export default async function MatchesView({
  userId,
  active,
}: MatchesViewProps) {
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
    <>
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
    </>
  );
}
