import { getUserId } from "@/lib/auth";
import { formatNumber } from "@/lib/format";
import { getInsights } from "@/lib/insights";
import Link from "next/link";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata = { title: "Overview" };

/** Format a monthly HKD figure as a compact salary string. */
function formatSalary(v: number): string {
  if (v <= 0) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
  return String(v);
}

/**
 * The real dashboard — an intelligence briefing on the user's job search.
 *
 * Signature element: the "Fit Profile" headline — a serif figure showing
 * the match rate, flanked by the user's top strengths and top gaps, plus a
 * trend sparkline. Below: a pipeline funnel and board/keyword mix, plus
 * deeper analytics: score distribution, salary intelligence, top matches,
 * application momentum, and actionable takeaways.
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
  const { scoreBuckets, salary, momentum, topMatches } = insights;

  // Actionable takeaways — computed from the data.
  const takeaways: { icon: string; tone: string; text: string }[] = [];
  if (momentum.matchesNotApplied > 0) {
    takeaways.push({
      icon: "📬",
      tone: "text-[var(--accent-ink)]",
      text: `${momentum.matchesNotApplied} strong match${momentum.matchesNotApplied === 1 ? "" : "es"} haven't been applied to yet — start with your top match.`,
    });
  }
  if (insights.gaps.length > 0) {
    takeaways.push({
      icon: "🎯",
      tone: "text-[var(--bad)]",
      text: `Closing the “${insights.gaps[0].term}” gap (appears in ${Math.round(insights.gaps[0].share * 100)}% of rejections) could unlock more matches.`,
    });
  }
  if (salary.withSalary > 0 && salary.topByKeyword.length > 0) {
    takeaways.push({
      icon: "💰",
      tone: "text-[var(--good)]",
      text: `Your best-paid search is “${salary.topByKeyword[0].keyword}” — averaging ${formatSalary(salary.topByKeyword[0].avgMonthly)}/month.`,
    });
  }
  if (momentum.coverLetterRate < 60 && total.matches > 0) {
    takeaways.push({
      icon: "✍️",
      tone: "text-[var(--accent-ink)]",
      text: `Only ${momentum.coverLetterRate}% of matches have a cover letter ready — generate the rest to apply faster.`,    });
  }
  if (takeaways.length === 0 && total.evaluated === 0) {
    takeaways.push({
      icon: "🚀",
      tone: "text-[var(--ink-soft)]",
      text: "Run your first search to start seeing analytics here.",
    });
  }

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
            what&apos;s holding you back, what it pays, and how the numbers
            move.
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
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--ink-soft)]">
                <span>
                  Avg score{" "}
                  <span className="font-data text-[var(--ink)] tabular-nums">
                    {insights.avgFitScore}
                  </span>
                </span>
                <span>
                  Median{" "}
                  <span className="font-data text-[var(--ink)] tabular-nums">
                    {insights.medianFitScore}
                  </span>
                </span>
              </div>
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

      {/* ── Score distribution + salary snapshot ───────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score distribution */}
        <div className="card p-8">
          <p className="eyebrow">Fit score distribution</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            How your evaluated jobs break down
          </p>
          <div className="mt-6 space-y-4">
            {[
              {
                label: "Strong fit (75+)",
                value: scoreBuckets.great,
                color: "bg-[var(--good)]",
                pct:
                  scoreBuckets.total > 0
                    ? Math.round((scoreBuckets.great / scoreBuckets.total) * 100)
                    : 0,
              },
              {
                label: "Possible (50–74)",
                value: scoreBuckets.possible,
                color: "bg-[var(--accent)]",
                pct:
                  scoreBuckets.total > 0
                    ? Math.round(
                        (scoreBuckets.possible / scoreBuckets.total) * 100,
                      )
                    : 0,
              },
              {
                label: "Low (below 50)",
                value: scoreBuckets.low,
                color: "bg-[var(--bad)]",
                pct:
                  scoreBuckets.total > 0
                    ? Math.round((scoreBuckets.low / scoreBuckets.total) * 100)
                    : 0,
              },
            ].map((b) => (
              <div key={b.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink)]">{b.label}</span>
                  <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                    {b.value} · {b.pct}%
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--paper-soft)] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${b.color}`}
                    style={{ width: `${Math.max(2, b.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Salary snapshot */}
        <div className="card p-8">
          <p className="eyebrow">Salary intelligence</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            What your matches pay (monthly, HKD)
          </p>
          {salary.withSalary > 0 ? (
            <>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-[var(--paper-soft)] p-4">
                  <p className="text-xs text-[var(--ink-soft)]">Median match</p>
                  <p className="mt-1 font-data text-3xl font-semibold text-[var(--ink)] tabular-nums">
                    ${formatSalary(salary.medianMonthly)}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--paper-soft)] p-4">
                  <p className="text-xs text-[var(--ink-soft)]">Average match</p>
                  <p className="mt-1 font-data text-3xl font-semibold text-[var(--ink)] tabular-nums">
                    ${formatSalary(salary.avgMonthly)}
                  </p>
                </div>
              </div>
              {/* Distribution bars */}
              <div className="mt-6 flex items-end gap-2 h-28">
                {salary.distribution.map((d, i) => {
                  const max = Math.max(
                    1,
                    ...salary.distribution.map((x) => x.count),
                  );
                  return (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center gap-1"
                    >
                      <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                        {d.count}
                      </span>
                      <div
                        className="w-full rounded-t bg-[var(--good)]"
                        style={{ height: `${(d.count / max) * 100}%` }}
                      />
                      <span className="text-[10px] text-[var(--ink-faint)] whitespace-nowrap">
                        {d.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm text-[var(--ink-faint)]">
              No salary data on your matches yet — evaluate more jobs.
            </p>
          )}
        </div>
      </section>

      {/* ── Top matches ────────────────────────────────────── */}
      {topMatches.length > 0 && (
        <section className="card p-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="eyebrow">Your best matches</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                The highest-scoring roles, with why they fit
              </p>
            </div>
            <Link
              href="/matches"
              className="text-sm font-semibold text-[var(--accent-ink)] hover:underline"
            >
              View all →
            </Link>
          </div>
          <ul className="mt-6 divide-y divide-[var(--line)]">
            {topMatches.map((m) => (
              <li key={m.id} className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/jobs/${m.id}`}
                        className="font-medium text-[var(--ink)] hover:underline truncate"
                      >
                        {m.title}
                      </Link>
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-[var(--good-soft)] text-[var(--good)]">
                        {m.fitScore}
                      </span>
                      {m.applied && (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--paper-soft)] text-[var(--ink-soft)]">
                          Applied
                        </span>
                      )}
                      {m.coverLetterDone && (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                          Letter ready
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {m.company}
                      {m.board && (
                        <span className="capitalize"> · {m.board}</span>
                      )}
                    </p>
                    {m.justification && (
                      <p className="mt-1.5 text-sm text-[var(--ink-soft)] leading-relaxed">
                        {m.justification}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {m.salary && (
                      <p className="text-sm font-medium text-[var(--ink)]">
                        {m.salary}
                      </p>
                    )}
                    <Link
                      href={`/jobs/${m.id}`}
                      className="mt-1 inline-block text-xs font-semibold text-[var(--accent-ink)] hover:underline"
                    >
                      Open →
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Actionable takeaways ───────────────────────────── */}
      {takeaways.length > 0 && (
        <section className="card p-8">
          <p className="eyebrow">What to do next</p>
          <ul className="mt-5 space-y-3">
            {takeaways.map((t, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm text-[var(--ink-soft)]"
              >
                <span className="shrink-0 text-base leading-6">{t.icon}</span>
                <span className={t.tone}>{t.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
              label: "Letters built",
              value: total.coverLetterBuilt,
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

      {/* ── Application momentum ───────────────────────────── */}
      <section className="card p-8">
        <p className="eyebrow">Application momentum</p>
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-xl bg-[var(--line)]">
          {[
            {
              label: "Applied",
              value: `${momentum.applied}`,
              sub: `${momentum.appliedRate}% of matches`,
            },
            {
              label: "Not interested",
              value: `${momentum.notInterested}`,
              sub: "dismissed",
            },
            {
              label: "Cover letters",
              value: `${momentum.coverLetterDone}`,
              sub: `${momentum.coverLetterRate}% of matches`,
            },
            {
              label: "Resumes built",
              value: `${momentum.resumeDone}`,
              sub: "ready to send",
            },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-[var(--surface)] p-5"
            >
              <p className="font-data text-3xl font-semibold text-[var(--ink)] tabular-nums">
                {s.value}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">{s.label}</p>
              <p className="text-[11px] text-[var(--ink-faint)]">{s.sub}</p>
            </div>
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
