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
  const isGoodStart = (word: string) =>
    /^[A-Z]/.test(word) ||
    /^[A-Za-z0-9]+[+#.]/.test(word) ||
    /^[a-z]{2,}$/.test(word);

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
      "id, fit, fit_score, fit_reasons, not_fit_reasons, applied, board, search_key, status, resume_status, pipeline_run_id, interested_in, created_at",
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
    pipeline_run_id: string | null;
    interested_in: boolean | null;
    created_at: string;
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

  return {
    totals: {
      scraped: jobs.length,
      evaluated: evaluated.length,
      reviewed: jobs.filter((j) => j.interested_in !== false).length,
      matches: matches.length,
      notFit: notFit.length,
      applied: jobs.filter((j) => j.applied === true).length,
      resumeBuilt: jobs.filter((j) => j.resume_status === "completed").length,
      duplicate: jobs.filter((j) => j.status === "duplicate").length,
    },
    avgFitScore,
    medianFitScore,
    strengths,
    gaps,
    trend,
    byBoard,
    byKeyword,
  };
}
