import { supabase } from "@/lib/supabase";

/**
 * Deep job-search intelligence.
 *
 * Turns raw scraped/evaluated jobs into genuinely useful insight:
 *   - Strengths   : skills/areas the user's resume most often matches on
 *   - Gaps        : the most common reasons jobs don't fit (what to improve)
 *   - Match trend : how fit has changed across recent runs
 *   - Funnel      : scraped → reviewed → matched → applied → resume built
 *   - Board mix   : which job boards produce the best matches
 *   - Keyword perf: which search_key yields the highest fit
 */

export interface FitInsight {
  /** The underlying term (skill / requirement / gap). */
  term: string;
  /** How many evaluated jobs reference it. */
  count: number;
  /** Share of evaluated jobs (0-1). */
  share: number;
}

export interface TrendPoint {
  label: string;
  avgScore: number;
  count: number;
}

export interface Insights {
  totals: {
    scraped: number;
    evaluated: number;
    reviewed: number;
    matches: number;
    notFit: number;
    applied: number;
    resumeBuilt: number;
    duplicate: number;
    coverLetterBuilt: number;
  };
  /** Average fit score across evaluated jobs (0-100). */
  avgFitScore: number;
  /** Median fit score. */
  medianFitScore: number;
  /** Most common strengths (from fit_reasons). */
  strengths: FitInsight[];
  /** Most common genuine gaps (from not_fit_reasons). */
  gaps: FitInsight[];
  /** Fit score over time (by run). */
  trend: TrendPoint[];
  /** Fit rate by job board. */
  byBoard: {
    board: string;
    evaluated: number;
    matches: number;
    fitRate: number;
  }[];
  /** Fit rate by search keyword. */
  byKeyword: {
    keyword: string;
    evaluated: number;
    matches: number;
    fitRate: number;
  }[];
  /** Fit-score bucket distribution (great / possible / low). */
  scoreBuckets: {
    great: number;
    possible: number;
    low: number;
    total: number;
  };
  /** Salary intelligence over MATCHES (real salary_min/max where available). */
  salary: {
    /** Median monthly salary (HKD) across matches with a salary range. */
    medianMonthly: number;
    /** Average monthly salary across matches with a salary range. */
    avgMonthly: number;
    /** Count of matches with a usable salary range. */
    withSalary: number;
    /** Monthly salary distribution buckets (HKD). */
    distribution: { label: string; count: number }[];
    /** Highest-paying search keywords (by avg monthly salary). */
    topByKeyword: { keyword: string; avgMonthly: number; count: number }[];
    /** Highest-paying job boards (by avg monthly salary). */
    topByBoard: { board: string; avgMonthly: number; count: number }[];
  };
  /** The user's strongest matches (top fit_score, with justification). */
  topMatches: {
    id: string;
    title: string;
    company: string;
    fitScore: number;
    justification: string;
    salary: string;
    applied: boolean;
    board: string;
    searchKey: string;
    coverLetterDone: boolean;
  }[];
  /** Application momentum (conversion rates + counts). */
  momentum: {
    applied: number;
    appliedRate: number;
    notInterested: number;
    matchesNotApplied: number;
    coverLetterDone: number;
    /** Total letters including ones built on non-match jobs. */
    totalLetters: number;
    coverLetterRate: number;
    resumeDone: number;
  };
}

/**
 * The raw JSON shape the `get_user_insights` Postgres RPC returns.
 * The DB does ALL the aggregation (strengths/gaps tokenization, salary
 * normalization, trend, boards, keywords, buckets, top matches, momentum)
 * so we only ship ~KB of computed JSON instead of up to 5000 raw job rows.
 */
type RpcInsights = Partial<{
  totals: {
    scraped: number;
    evaluated: number;
    reviewed: number;
    matches: number;
    notFit: number;
    applied: number;
    resumeBuilt: number;
    coverLetterBuilt: number;
    duplicate: number;
  };
  avgFitScore: number;
  medianFitScore: number;
  strengths: { term: string; count: number; share: number }[];
  gaps: { term: string; count: number; share: number }[];
  trend: { label: string; avgScore: number; count: number }[];
  byBoard: {
    board: string;
    evaluated: number;
    matches: number;
    fitRate: number;
  }[];
  byKeyword: {
    keyword: string;
    evaluated: number;
    matches: number;
    fitRate: number;
  }[];
  scoreBuckets: { great: number; possible: number; low: number; total: number };
  salary: {
    medianMonthly: number;
    avgMonthly: number;
    withSalary: number;
    distribution: { label: string; count: number }[];
    topByKeyword: { keyword: string; avgMonthly: number; count: number }[];
    topByBoard: { board: string; avgMonthly: number; count: number }[];
  };
  topMatches: {
    id: string;
    title: string;
    company: string;
    fitScore: number;
    justification: string;
    salary: string;
    applied: boolean;
    board: string;
    searchKey: string;
    coverLetterDone: boolean;
  }[];
  momentum: {
    applied: number;
    appliedRate: number;
    notInterested: number;
    matchesNotApplied: number;
    coverLetterDone: number;
    totalLetters: number;
    coverLetterRate: number;
    resumeDone: number;
  };
}>;

/** Defensive fillers so a partial/empty RPC result still satisfies the contract. */
const EMPTY_INSIGHTS: Insights = {
  totals: {
    scraped: 0,
    evaluated: 0,
    reviewed: 0,
    matches: 0,
    notFit: 0,
    applied: 0,
    resumeBuilt: 0,
    duplicate: 0,
    coverLetterBuilt: 0,
  },
  avgFitScore: 0,
  medianFitScore: 0,
  strengths: [],
  gaps: [],
  trend: [],
  byBoard: [],
  byKeyword: [],
  scoreBuckets: { great: 0, possible: 0, low: 0, total: 0 },
  salary: {
    medianMonthly: 0,
    avgMonthly: 0,
    withSalary: 0,
    distribution: [
      { label: "≤ 15k", count: 0 },
      { label: "15–25k", count: 0 },
      { label: "25–40k", count: 0 },
      { label: "40–60k", count: 0 },
      { label: "60k+", count: 0 },
    ],
    topByKeyword: [],
    topByBoard: [],
  },
  topMatches: [],
  momentum: {
    applied: 0,
    appliedRate: 0,
    notInterested: 0,
    matchesNotApplied: 0,
    coverLetterDone: 0,
    totalLetters: 0,
    coverLetterRate: 0,
    resumeDone: 0,
  },
};

/**
 * Deep job-search intelligence — computed IN POSTGRES.
 *
 * Calls the `get_user_insights` RPC (a single SQL aggregation pass over the
 * user's jobs, using the `idx_jobs_user_created_at` index) instead of
 * shipping up to 5000 raw rows × 22 columns to Node. This:
 *   - cuts the Supabase payload ~1000× (MBs → KB),
 *   - removes the old `.limit(5000)` truncation (SQL aggregates ALL rows,
 *     so insight is MORE accurate for power users),
 *   - keeps every metric identical to the previous Node computation.
 */
export async function getInsights(userId: string): Promise<Insights> {
  if (!userId) return EMPTY_INSIGHTS;

  const { data, error } = await supabase.rpc("get_user_insights", {
    p_user_id: userId,
  });

  if (error || !data) {
    console.error("[insights] query error:", error?.message ?? "no data");
    return EMPTY_INSIGHTS;
  }

  const r = data as RpcInsights;
  const t = r.totals;
  const mom = r.momentum;
  const sal = r.salary;

  return {
    totals: {
      scraped: t?.scraped ?? 0,
      evaluated: t?.evaluated ?? 0,
      reviewed: t?.reviewed ?? 0,
      matches: t?.matches ?? 0,
      notFit: t?.notFit ?? 0,
      applied: t?.applied ?? 0,
      resumeBuilt: t?.resumeBuilt ?? 0,
      duplicate: t?.duplicate ?? 0,
      coverLetterBuilt: t?.coverLetterBuilt ?? 0,
    },
    avgFitScore: r.avgFitScore ?? 0,
    medianFitScore: r.medianFitScore ?? 0,
    strengths: (r.strengths ?? []).map((s) => ({
      term: s.term,
      count: s.count,
      share: s.share,
    })),
    gaps: (r.gaps ?? []).map((g) => ({
      term: g.term,
      count: g.count,
      share: g.share,
    })),
    trend: (r.trend ?? []).map((p) => ({
      label: p.label,
      avgScore: p.avgScore,
      count: p.count,
    })),
    byBoard: (r.byBoard ?? []).map((b) => ({
      board: b.board,
      evaluated: b.evaluated,
      matches: b.matches,
      fitRate: b.fitRate,
    })),
    byKeyword: (r.byKeyword ?? []).map((k) => ({
      keyword: k.keyword,
      evaluated: k.evaluated,
      matches: k.matches,
      fitRate: k.fitRate,
    })),
    scoreBuckets: {
      great: r.scoreBuckets?.great ?? 0,
      possible: r.scoreBuckets?.possible ?? 0,
      low: r.scoreBuckets?.low ?? 0,
      total: r.scoreBuckets?.total ?? 0,
    },
    salary: {
      medianMonthly: sal?.medianMonthly ?? 0,
      avgMonthly: sal?.avgMonthly ?? 0,
      withSalary: sal?.withSalary ?? 0,
      distribution: (sal?.distribution ?? []).map((d) => ({
        label: d.label,
        count: d.count,
      })),
      topByKeyword: (sal?.topByKeyword ?? []).map((k) => ({
        keyword: k.keyword,
        avgMonthly: k.avgMonthly,
        count: k.count,
      })),
      topByBoard: (sal?.topByBoard ?? []).map((b) => ({
        board: b.board,
        avgMonthly: b.avgMonthly,
        count: b.count,
      })),
    },
    topMatches: (r.topMatches ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      company: m.company,
      fitScore: m.fitScore,
      justification: m.justification,
      salary: m.salary,
      applied: m.applied === true,
      board: m.board,
      searchKey: m.searchKey,
      coverLetterDone: m.coverLetterDone === true,
    })),
    momentum: {
      applied: mom?.applied ?? 0,
      appliedRate: mom?.appliedRate ?? 0,
      notInterested: mom?.notInterested ?? 0,
      matchesNotApplied: mom?.matchesNotApplied ?? 0,
      coverLetterDone: mom?.coverLetterDone ?? 0,
      totalLetters: mom?.totalLetters ?? 0,
      coverLetterRate: mom?.coverLetterRate ?? 0,
      resumeDone: mom?.resumeDone ?? 0,
    },
  };
}
