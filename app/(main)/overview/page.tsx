import { getUserId } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { getInsights } from "@/lib/insights";
import Link from "next/link";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata = { title: "Overview" };

/**
 * The real dashboard — an intelligence briefing on the user's job search.
 *
 * Signature element: the "Fit Profile" headline — a serif figure showing
 * the match rate, flanked by the user's top strengths and top gaps, plus a
 * trend sparkline. Below: a pipeline funnel and board/keyword mix.
 */
export default async function OverviewPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const insights = await getInsights(userId);

  const total = insights.totals;
  const matchRate =
    total.evaluated > 0
      ? Math.round((total.matches / total.evaluated) * 100)
      : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 space-y-10">
      {/* ── Page header ─────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Overview</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[var(--ink)]">
            Your search, understood
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)] max-w-xl">
            A live read on how your profile is landing — what you match on,
            what's holding you back, and how the numbers move.
          </p>
        </div>
        <Link
          href="/search"
          className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--accent-ink)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        >
          Search jobs
          <span aria-hidden>→</span>
        </Link>
      </header>

      {/* ── Hero: Fit Profile (the signature) ──────────────── */}
      <section className="card overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-3">
          {/* Match-rate figure */}
          <div className="p-8 lg:border-r border-[var(--line)] flex flex-col justify-between gap-6">
            <div>
              <p className="eyebrow">Match rate</p>
              <p className="mt-3 font-serif text-6xl sm:text-7xl leading-none text-[var(--ink)] tabular-nums">
                {matchRate}
                <span className="text-3xl text-[var(--ink-faint)]">%</span>
              </p>
              <p className="mt-3 text-sm text-[var(--ink-soft)]">
                {total.matches} of {total.evaluated} evaluated jobs fit your
                profile
              </p>
            </div>
            <div className="flex items-end gap-1 h-16">
              {insights.trend.map((t, i) => (
                <div
                  key={i}
                  title={`${t.label}: ${t.avgScore}`}
                  className="flex-1 rounded-t bg-[var(--accent-soft)] border-t-2 border-[var(--accent)]"
                  style={{
                    height: `${Math.max(12, (t.avgScore / 100) * 100)}%`,
                    opacity:
                      0.5 + (i / Math.max(1, insights.trend.length - 1)) * 0.5,
                  }}
                />
              ))}
            </div>
            {insights.trend.length > 1 && (
              <p className="text-xs text-[var(--ink-faint)]">
                Average fit score over your last {insights.trend.length}{" "}
                searches
              </p>
            )}
          </div>

          {/* Strengths */}
          <div className="p-8 lg:border-r border-[var(--line)]">
            <p className="eyebrow text-[var(--good)]">Strengths</p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              What your profile most often matches on
            </p>
            <ul className="mt-5 space-y-3">
              {insights.strengths.length === 0 && (
                <li className="text-sm text-[var(--ink-faint)]">
                  Evaluate some jobs to surface your strengths.
                </li>
              )}
              {insights.strengths.map((s) => (
                <li
                  key={s.term}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-sm font-medium text-[var(--ink)]">
                    {s.term}
                  </span>
                  <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                    {Math.round(s.share * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Gaps */}
          <div className="p-8">
            <p className="eyebrow text-[var(--bad)]">Gaps</p>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              What most often holds a job back from fitting
            </p>
            <ul className="mt-5 space-y-3">
              {insights.gaps.length === 0 && (
                <li className="text-sm text-[var(--ink-faint)]">
                  No common gaps yet — great sign.
                </li>
              )}
              {insights.gaps.map((g) => (
                <li
                  key={g.term}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="text-sm text-[var(--ink)]">{g.term}</span>
                  <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                    {Math.round(g.share * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Pipeline funnel ─────────────────────────────────── */}
      <section className="card p-8">
        <p className="eyebrow">Pipeline</p>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px overflow-hidden rounded-xl bg-[var(--line)]">
          {[
            { label: "Scraped", value: total.scraped, href: "/review" },
            { label: "Evaluated", value: total.evaluated, href: "/review" },
            { label: "Matches", value: total.matches, href: "/matches" },
            { label: "Applied", value: total.applied, href: "/matches" },
            {
              label: "Resumes built",
              value: total.resumeBuilt,
              href: "/matches",
            },
            { label: "Not a fit", value: total.notFit, href: "/matches" },
          ].map((s) => (
            <Link
              key={s.label}
              href={s.href}
              className="bg-[var(--surface)] p-5 card-hover hover:bg-[var(--paper-soft)]"
            >
              <p className="font-data text-3xl font-semibold text-[var(--ink)] tabular-nums">
                {formatNumber(s.value)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">{s.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Board + keyword mix ─────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-8">
          <p className="eyebrow">By job board</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Where your best matches come from
          </p>
          <ul className="mt-5 space-y-4">
            {insights.byBoard.length === 0 && (
              <li className="text-sm text-[var(--ink-faint)]">
                No evaluated jobs yet.
              </li>
            )}
            {insights.byBoard.map((b) => (
              <li key={b.board}>
                <div className="flex items-center justify-between text-sm">
                  <span className="capitalize font-medium text-[var(--ink)]">
                    {b.board}
                  </span>
                  <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                    {b.matches}/{b.evaluated} · {b.fitRate}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--paper-soft)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${b.fitRate}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-8">
          <p className="eyebrow">By search keyword</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Which searches find the best fits
          </p>
          <ul className="mt-5 space-y-4">
            {insights.byKeyword.length === 0 && (
              <li className="text-sm text-[var(--ink-faint)]">
                No searches evaluated yet.
              </li>
            )}
            {insights.byKeyword.map((k) => (
              <li key={k.keyword}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[var(--ink)]">
                    {k.keyword}
                  </span>
                  <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                    {k.matches}/{k.evaluated} · {k.fitRate}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--paper-soft)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--good)]"
                    style={{ width: `${k.fitRate}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
