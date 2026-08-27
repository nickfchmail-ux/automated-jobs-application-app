/**
 * Client-safe entitlement types + pure helpers.
 *
 * This module has NO server-only imports (no next/headers, no supabase) so
 * it can be imported by client components (EvaluationStep, ScrapePanel, …).
 * The server-side logic lives in lib/entitlements.ts (which re-exports from
 * here); keep anything touching cookies/DB out of this file.
 */

export type Role = "user" | "admin";
export type Plan = "free" | "standard" | "pro";
export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type UsageType =
  | "search"
  | "evaluation"
  | "fine_tune_resume"
  | "fine_tune_cover_letter";

/** Search-board capability gating by plan. */
export type BoardCapability = {
  /** Whether the user can scrape Indeed. */
  indeedEnabled: boolean;
  /** Max pages per search (1 for standard, Infinity for pro/admin). */
  maxPages: number;
  /** Max results per job board per search (5 free, 10 standard, ∞ pro). */
  maxResultsPerBoard: number;
};

export interface PlanLimits {
  /** Monthly usage allowance (per period). */
  monthly: {
    searches: number;
    evaluations: number;
    fineTuneResume: number;
    fineTuneCoverLetter: number;
  };
  /** Search capability restrictions. */
  search: BoardCapability;
  /** True if this plan has no usage limits (unlimited). */
  unlimited: boolean;
}

export interface EntitlementSummary {
  role: Role;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  /** Human-friendly plan label. */
  planLabel: string;
  /** The effective limits for this plan (admin → unlimited). */
  limits: PlanLimits;
  /** Current-period usage (for the UI). */
  usage: {
    searches: number;
    evaluations: number;
    fineTuneResume: number;
    fineTuneCoverLetter: number;
    /** Per-search-key usage (free tier). */
    searchesByKey: Record<string, number>;
    evaluationsByKey: Record<string, number>;
  };
  /** Start of the current usage period (for "resets on X"). */
  periodStart: string | null;
  /** Period end (from Stripe) or null. */
  periodEnd: string | null;
}

/** Free-tier lifetime allowance: 1 search total, 1 evaluation total, 1 fine-tune each. */
export const FREE_SEARCH_LIMIT = 1;
export const FREE_EVALUATION_LIMIT = 1;
export const FREE_FINE_TUNE_LIMIT = 1;

/** Normalize a keyword to the stored search_key form ("Web Developer" → "web_developer"). */
export function normalizeKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function usageKey(s: string | null | undefined): string {
  return normalizeKey(s) || "general";
}

/**
 * Does the user still have quota for `type`?
 * - Unlimited plans always return true.
 * - Free: 1 search total + 1 evaluation total + 1 fine-tune each (lifetime).
 * - Standard/Pro: total monthly quota.
 */
export function hasQuota(
  summary: EntitlementSummary,
  type: UsageType,
  _searchKey?: string | null,
): boolean {
  if (summary.limits.unlimited) return true;
  switch (type) {
    case "search":
      if (summary.plan === "free")
        return summary.usage.searches < FREE_SEARCH_LIMIT;
      return summary.usage.searches < summary.limits.monthly.searches;
    case "evaluation":
      if (summary.plan === "free")
        return summary.usage.evaluations < FREE_EVALUATION_LIMIT;
      return summary.usage.evaluations < summary.limits.monthly.evaluations;
    case "fine_tune_resume":
      return (
        summary.usage.fineTuneResume <
        (summary.plan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : summary.limits.monthly.fineTuneResume)
      );
    case "fine_tune_cover_letter":
      return (
        summary.usage.fineTuneCoverLetter <
        (summary.plan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : summary.limits.monthly.fineTuneCoverLetter)
      );
  }
}

/** Remaining count for `type` (Infinity for unlimited). */
export function remainingQuota(
  summary: EntitlementSummary,
  type: UsageType,
  _searchKey?: string | null,
): number {
  if (summary.limits.unlimited) return Number.POSITIVE_INFINITY;
  switch (type) {
    case "search":
      if (summary.plan === "free")
        return Math.max(0, FREE_SEARCH_LIMIT - summary.usage.searches);
      return Math.max(
        0,
        summary.limits.monthly.searches - summary.usage.searches,
      );
    case "evaluation":
      if (summary.plan === "free")
        return Math.max(0, FREE_EVALUATION_LIMIT - summary.usage.evaluations);
      return Math.max(
        0,
        summary.limits.monthly.evaluations - summary.usage.evaluations,
      );
    case "fine_tune_resume":
      return Math.max(
        0,
        (summary.plan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : summary.limits.monthly.fineTuneResume) -
          summary.usage.fineTuneResume,
      );
    case "fine_tune_cover_letter":
      return Math.max(
        0,
        (summary.plan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : summary.limits.monthly.fineTuneCoverLetter) -
          summary.usage.fineTuneCoverLetter,
      );
  }
}
