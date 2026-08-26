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
    coverLetterRate: number;
    resumeDone: number;
  };
}

/** Pull the tokens out of a list of free-text reasons (fit_reasons / not_fit_reasons). */
function tokenize(reasons: string[]): string[] {
  const tokens: string[] = [];
  // Words that make a fragment noisy (sentence connectives / vague nouns).
  const stop = new Set([
    "the",
    "and",
    "with",
    "for",
    "in",
    "of",
    "no",
    "a",
    "an",
    "to",
    "on",
    "is",
    "are",
    "as",
    "or",
    "at",
    "be",
    "not",
    "which",
    "that",
    "this",
    "their",
    "his",
    "her",
    "its",
    "experience",
    "expertise",
    "skills",
    "skill",
    "knowledge",
    "strong",
    "good",
    "working",
    "hands",
    "related",
    "proficiency",
    "proficient",
    "relevant",
    "years",
    "year",
    "role",
    "jobs",
    "job",
    "work",
    "development",
    "developer",
    "engineer",
    "requirement",
    "requirements",
    "candidate",
    "position",
    "company",
    "team",
    "ability",
    "experience.",
    "background",
    "demonstrated",
    "demonstrates",
    "proven",
  ]);
  // Only keep phrases that START with a proper noun / tech term (capitalized
  // or a known tool pattern), so we surface "React", "Next.js", "Django"
  // instead of fragments like "years of" or "which is".
  for (const r of reasons ?? []) {
    const s = String(r ?? "");
    // Match noun phrases: capitalized tech terms + one following word.
    const phrases =
      s.match(/([A-Z][A-Za-z0-9+#.]+(?: [A-Za-z][A-Za-z0-9+#.]+)?)/g) ?? [];
    for (const p of phrases) {
      const words = p.trim().split(/\s+/);
      const first = words[0];
      const last = words[words.length - 1].toLowerCase();
      // Drop fragments that end in a stopword or are pure filler.
      if (stop.has(last) || stop.has(first.toLowerCase())) continue;
      if (first.length < 2) continue;
      tokens.push(p.trim());
    }
  }
  return tokens;
}

/** Count token frequency, return top N. */
function topTokens(tokens: string[], total: number, n = 6): FitInsight[] {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term, count]) => ({
      term,
      count,
      share: total ? count / total : 0,
    }));
}

/** Median of an array. */
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function getInsights(userId: string): Promise<Insights> {
  // Pull all the fields we need for insight (not just counts).
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, fit, fit_score, fit_reasons, not_fit_reasons, applied, board, search_key, status, resume_status, cover_letter_status, pipeline_run_id, interested_in, created_at, title, company, justification, expected_salary, salary_min, salary_max, salary_currency, salary_period",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[insights] query error:", error.message);
  }
  const jobs = (data ?? []) as (Record<string, unknown> & {
    fit: boolean | null;
    fit_score: number | null;
    fit_reasons: string[] | null;
    not_fit_reasons: string[] | null;
    applied: boolean | null;
    board: string | null;
    search_key: string | null;
    status: string | null;
    resume_status: string | null;
    cover_letter_status: string | null;
    pipeline_run_id: string | null;
    interested_in: boolean | null;
    created_at: string;
    title: string | null;
    company: string | null;
    justification: string | null;
    expected_salary: string | null;
    salary_min: number | null;
    salary_max: number | null;
    salary_currency: string | null;
    salary_period: string | null;
  })[];

  const evaluated = jobs.filter((j) => j.fit !== null);
  const matches = evaluated.filter((j) => j.fit === true);
  const notFit = evaluated.filter((j) => j.fit === false);
  const scores = evaluated
    .map((j) => Number(j.fit_score ?? 0))
    .filter((n) => Number.isFinite(n));
  const avgFitScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const medianFitScore = Math.round(median(scores));

  // Strengths from fit_reasons; gaps from not_fit_reasons.
  const strengthTokens = tokenize(matches.flatMap((j) => j.fit_reasons ?? []));
  const gapTokens = tokenize(notFit.flatMap((j) => j.not_fit_reasons ?? []));
  const strengths = topTokens(strengthTokens, Math.max(1, matches.length));
  const gaps = topTokens(gapTokens, Math.max(1, notFit.length));

  // Trend: group evaluated jobs by run, oldest → newest, avg score.
  const byRun = new Map<string, { label: string; scores: number[] }>();
  for (const j of evaluated) {
    const runId = String(j.pipeline_run_id ?? "other");
    const entry = byRun.get(runId) ?? {
      label: runId === "other" ? "Earlier" : "",
      scores: [],
    };
    if (Number.isFinite(Number(j.fit_score)))
      entry.scores.push(Number(j.fit_score));
    byRun.set(runId, entry);
  }
  const runOrder = [...byRun.entries()];
  const trend: TrendPoint[] = runOrder.slice(0, 8).map(([runId, e], i) => ({
    label: runId === "other" ? "Earlier" : `Run ${i + 1}`,
    avgScore: Math.round(
      e.scores.reduce((a, b) => a + b, 0) / Math.max(1, e.scores.length),
    ),
    count: e.scores.length,
  }));

  // Board mix.
  const byBoardMap = new Map<string, { evaluated: number; matches: number }>();
  for (const j of evaluated) {
    const b = String(j.board ?? "other");
    const e = byBoardMap.get(b) ?? { evaluated: 0, matches: 0 };
    e.evaluated++;
    if (j.fit) e.matches++;
    byBoardMap.set(b, e);
  }
  const byBoard = [...byBoardMap.entries()]
    .map(([board, e]) => ({
      board,
      evaluated: e.evaluated,
      matches: e.matches,
      fitRate: e.evaluated ? Math.round((e.matches / e.evaluated) * 100) : 0,
    }))
    .sort((a, b) => b.evaluated - a.evaluated)
    .slice(0, 6);

  // Keyword performance.
  const byKwMap = new Map<string, { evaluated: number; matches: number }>();
  for (const j of evaluated) {
    const k = String(j.search_key ?? "general");
    const e = byKwMap.get(k) ?? { evaluated: 0, matches: 0 };
    e.evaluated++;
    if (j.fit) e.matches++;
    byKwMap.set(k, e);
  }
  const byKeyword = [...byKwMap.entries()]
    .map(([keyword, e]) => ({
      keyword,
      evaluated: e.evaluated,
      matches: e.matches,
      fitRate: e.evaluated ? Math.round((e.matches / e.evaluated) * 100) : 0,
    }))
    .filter((k) => k.evaluated > 0)
    .sort((a, b) => b.fitRate - a.fitRate)
    .slice(0, 6);

  // ── Fit-score bucket distribution ────────────────────────────────
  const scoreBuckets = { great: 0, possible: 0, low: 0, total: evaluated.length };
  for (const j of evaluated) {
    const s = Number(j.fit_score ?? 0);
    if (s >= 75) scoreBuckets.great++;
    else if (s >= 50) scoreBuckets.possible++;
    else scoreBuckets.low++;
  }

  // ── Salary intelligence (over MATCHES with a real salary range) ──
  // Normalize to monthly HKD for comparison.
  const toMonthly = (j: typeof evaluated[number]): number | null => {
    if (j.salary_min == null || j.salary_max == null) return null;
    let min = Number(j.salary_min);
    let max = Number(j.salary_max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return null;
    const period = String(j.salary_period ?? "month").toLowerCase();
    if (period.includes("year") || period.includes("annual")) {
      min /= 12;
      max /= 12;
    } else if (period.includes("hour") || period.includes("hr")) {
      min *= 160; // ~full-time hours/month
      max *= 160;
    }
    return Math.round((min + max) / 2);
  };

  const salaries = matches
    .map((j) => ({ j, monthly: toMonthly(j) }))
    .filter((x): x is { j: (typeof matches)[number]; monthly: number } =>
      x.monthly !== null && x.monthly > 0,
    );
  const monthlyVals = salaries.map((s) => s.monthly).sort((a, b) => a - b);
  const medianMonthly = monthlyVals.length
    ? monthlyVals[Math.floor(monthlyVals.length / 2)]
    : 0;
  const avgMonthly = monthlyVals.length
    ? Math.round(
        monthlyVals.reduce((a, b) => a + b, 0) / monthlyVals.length,
      )
    : 0;

  const salaryDistribution = [
    { label: "≤ 15k", count: 0 },
    { label: "15–25k", count: 0 },
    { label: "25–40k", count: 0 },
    { label: "40–60k", count: 0 },
    { label: "60k+", count: 0 },
  ];
  for (const v of monthlyVals) {
    if (v <= 15000) salaryDistribution[0].count++;
    else if (v <= 25000) salaryDistribution[1].count++;
    else if (v <= 40000) salaryDistribution[2].count++;
    else if (v <= 60000) salaryDistribution[3].count++;
    else salaryDistribution[4].count++;
  }

  // Highest-paying keywords + boards (by avg monthly salary of matches).
  const salByKw = new Map<string, { sum: number; count: number }>();
  const salByBoard = new Map<string, { sum: number; count: number }>();
  for (const { j, monthly } of salaries) {
    const kw = String(j.search_key ?? "general");
    const e = salByKw.get(kw) ?? { sum: 0, count: 0 };
    e.sum += monthly;
    e.count++;
    salByKw.set(kw, e);
    const b = String(j.board ?? "other");
    const eb = salByBoard.get(b) ?? { sum: 0, count: 0 };
    eb.sum += monthly;
    eb.count++;
    salByBoard.set(b, eb);
  }
  const salaryTopKw = [...salByKw.entries()]
    .map(([keyword, e]) => ({
      keyword,
      avgMonthly: Math.round(e.sum / e.count),
      count: e.count,
    }))
    .filter((k) => k.count >= 1)
    .sort((a, b) => b.avgMonthly - a.avgMonthly)
    .slice(0, 5);
  const salaryTopBoard = [...salByBoard.entries()]
    .map(([board, e]) => ({
      board,
      avgMonthly: Math.round(e.sum / e.count),
      count: e.count,
    }))
    .filter((k) => k.count >= 1)
    .sort((a, b) => b.avgMonthly - a.avgMonthly)
    .slice(0, 5);

  // ── Top matches (strongest fit with justification + salary) ──────
  const topMatches = matches
    .map((j) => ({
      id: String(j.id),
      title: String(j.title ?? "Untitled role"),
      company: String(j.company ?? "Unknown company"),
      fitScore: Math.round(Number(j.fit_score ?? 0)),
      justification: String(j.justification ?? ""),
      salary: String(j.expected_salary ?? ""),
      applied: j.applied === true,
      board: String(j.board ?? ""),
      searchKey: String(j.search_key ?? ""),
      coverLetterDone: j.cover_letter_status === "completed",
    }))
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 6);

  // ── Application momentum ─────────────────────────────────────────
  const appliedCount = jobs.filter((j) => j.applied === true).length;
  const notInterestedCount = jobs.filter((j) => j.interested_in === false).length;
  const coverLetterDone = jobs.filter(
    (j) => j.cover_letter_status === "completed",
  ).length;
  const resumeDone = jobs.filter((j) => j.resume_status === "completed").length;
  const momentum = {
    applied: appliedCount,
    appliedRate: matches.length
      ? Math.round((appliedCount / matches.length) * 100)
      : 0,
    notInterested: notInterestedCount,
    matchesNotApplied: matches.length - appliedCount,
    coverLetterDone,
    coverLetterRate: matches.length
      ? Math.round((coverLetterDone / matches.length) * 100)
      : 0,
    resumeDone,
  };

  return {
    totals: {
      scraped: jobs.length,
      evaluated: evaluated.length,
      reviewed: jobs.filter((j) => j.interested_in !== false).length,
      matches: matches.length,
      notFit: notFit.length,
      applied: appliedCount,
      resumeBuilt: resumeDone,
      coverLetterBuilt: coverLetterDone,
      duplicate: jobs.filter((j) => j.status === "duplicate").length,
    },
    avgFitScore,
    medianFitScore,
    strengths,
    gaps,
    trend,
    byBoard,
    byKeyword,
    scoreBuckets,
    salary: {
      medianMonthly,
      avgMonthly,
      withSalary: monthlyVals.length,
      distribution: salaryDistribution,
      topByKeyword: salaryTopKw,
      topByBoard: salaryTopBoard,
    },
    topMatches,
    momentum,
  };
}
