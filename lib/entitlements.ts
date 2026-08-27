import { getUserId } from "@/lib/auth";
import { requireServiceClient } from "@/lib/supabase";

// Client-safe types + pure helpers live in the shared module (no server-only
// imports), so client components can import them without pulling in
// next/headers. This server module imports them locally AND re-exports them.
import {
  type EntitlementSummary,
  FREE_EVALUATION_LIMIT,
  FREE_FINE_TUNE_LIMIT,
  FREE_SEARCH_LIMIT,
  normalizeKey,
  type Plan,
  type PlanLimits,
  type Role,
  type SubscriptionStatus,
  type UsageType,
} from "@/lib/entitlements-shared";

export {
  FREE_EVALUATION_LIMIT,
  FREE_FINE_TUNE_LIMIT,
  FREE_SEARCH_LIMIT,
  hasQuota,
  normalizeKey,
  remainingQuota,
  type BoardCapability,
  type EntitlementSummary,
  type Plan,
  type PlanLimits,
  type Role,
  type SubscriptionStatus,
  type UsageType,
} from "@/lib/entitlements-shared";

/* ------------------------------------------------------------------ */
/*  Entitlements — usage-based plans for JobSeek.                      */
/*                                                                     */
/*  Plan model (HKD/month, IP-localized via lib/pricing.ts):           */
/*    free     : lifetime — 1 search + 1 eval per search key,          */
/*               1 fine-tune each (resume + cover letter)              */
/*    standard : 150 HKD/mo — 30 search / 30 eval / 30 fine-tune each, */
/*               1-page searches only, Indeed DISABLED                 */
/*    pro      : 300 HKD/mo — 70 search / 70 eval / 70 fine-tune each, */
/*               multi-page + Indeed ENABLED                           */
/*    admin    : unlimited (ADMIN_EMAILS env → role)                   */
/*                                                                     */
/*  Monthly reset: usage counts only rows with created_at >=           */
/*  `usage_period_start` on the profile (aligned to the Stripe billing  */
/*  period). Rows are retained for audit.                              */
/*                                                                     */
/*  Every consuming action calls `consumeEntitlement` which checks the  */
/*  limit then records usage. A unique constraint + count-before-insert */
/*  keeps concurrent requests from double-spending the last slot.       */
/* ------------------------------------------------------------------ */

/* ── Plan definitions ─────────────────────────────────────────── */

export const PLAN_DEFS: Record<Plan, { label: string; limits: PlanLimits }> = {
  free: {
    label: "Free",
    limits: {
      monthly: {
        searches: 1,
        evaluations: 1,
        fineTuneResume: 1,
        fineTuneCoverLetter: 1,
      },
      // 1-page, NO Indeed, max 5 results per board
      search: { indeedEnabled: false, maxPages: 1, maxResultsPerBoard: 5 },
      unlimited: false,
    },
  },
  standard: {
    label: "Standard",
    limits: {
      monthly: {
        searches: 30,
        evaluations: 30,
        fineTuneResume: 30,
        fineTuneCoverLetter: 30,
      },
      // 1-page only, Indeed DISABLED, max 10 results per board
      search: { indeedEnabled: false, maxPages: 1, maxResultsPerBoard: 10 },
      unlimited: false,
    },
  },
  pro: {
    label: "Pro",
    limits: {
      monthly: {
        searches: 70,
        evaluations: 70,
        fineTuneResume: 70,
        fineTuneCoverLetter: 70,
      },
      // multi-page + Indeed ENABLED, no per-board result cap
      search: {
        indeedEnabled: true,
        maxPages: Number.POSITIVE_INFINITY,
        maxResultsPerBoard: Number.POSITIVE_INFINITY,
      },
      unlimited: false,
    },
  },
};

/** Admin override — unlimited everything. */
export const ADMIN_LIMITS: PlanLimits = {
  monthly: {
    searches: Number.POSITIVE_INFINITY,
    evaluations: Number.POSITIVE_INFINITY,
    fineTuneResume: Number.POSITIVE_INFINITY,
    fineTuneCoverLetter: Number.POSITIVE_INFINITY,
  },
  search: {
    indeedEnabled: true,
    maxPages: Number.POSITIVE_INFINITY,
    maxResultsPerBoard: Number.POSITIVE_INFINITY,
  },
  unlimited: true,
};

function usageKey(s: string | null | undefined): string {
  return normalizeKey(s) || "general";
}

/* ── Entitlements ledger (allowed vs used) ────────────────────── */

export interface EntitlementsLedger {
  userId: string;
  plan: Plan;
  allowedSearches: number;
  allowedEvaluations: number;
  allowedFineTuneResume: number;
  allowedFineTuneCover: number;
  usedSearches: number;
  usedEvaluations: number;
  usedFineTuneResume: number;
  usedFineTuneCover: number;
  periodStartedAt: string;
  periodEndsAt: string | null;
}

/**
 * The allowance a plan grants. Free = 1 each (1 search + 1 eval per key,
 * 1 fine-tune each); Standard = 30 each; Pro = 70 each.
 */
export function planAllowance(plan: Plan): {
  searches: number;
  evaluations: number;
  fineTuneResume: number;
  fineTuneCoverLetter: number;
} {
  if (plan === "standard")
    return {
      searches: 30,
      evaluations: 30,
      fineTuneResume: 30,
      fineTuneCoverLetter: 30,
    };
  if (plan === "pro")
    return {
      searches: 70,
      evaluations: 70,
      fineTuneResume: 70,
      fineTuneCoverLetter: 70,
    };
  return {
    searches: 1,
    evaluations: 1,
    fineTuneResume: 1,
    fineTuneCoverLetter: 1,
  };
}

/** Read the user's entitlements ledger, lazily CREATING it if absent. */
export async function getEntitlementsLedger(
  userId: string,
  plan: Plan = "free",
): Promise<EntitlementsLedger | null> {
  const supabase = requireServiceClient();
  const { data, error } = await supabase
    .from("entitlements")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[entitlements] ledger read error:", error.message);
    return null;
  }
  if (data) return mapLedgerRow(data);

  // No ledger row yet → create one for the given plan (default free).
  const allowance = planAllowance(plan);
  const now = new Date().toISOString();
  const { data: created, error: createErr } = await supabase
    .from("entitlements")
    .insert({
      user_id: userId,
      plan,
      allowed_searches: allowance.searches,
      allowed_evaluations: allowance.evaluations,
      allowed_fine_tune_resume: allowance.fineTuneResume,
      allowed_fine_tune_cover: allowance.fineTuneCoverLetter,
      used_searches: 0,
      used_evaluations: 0,
      used_fine_tune_resume: 0,
      used_fine_tune_cover: 0,
      period_started_at: now,
    })
    .select()
    .maybeSingle();
  if (createErr && createErr.code !== "23505") {
    console.error("[entitlements] ledger create error:", createErr.message);
    return null;
  }
  if (created) return mapLedgerRow(created);
  // A concurrent insert won → re-read.
  const { data: retry } = await supabase
    .from("entitlements")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return retry ? mapLedgerRow(retry) : null;
}

function mapLedgerRow(row: Record<string, unknown>): EntitlementsLedger {
  return {
    userId: String(row.user_id),
    plan: (row.plan as Plan) ?? "free",
    allowedSearches: Number(row.allowed_searches) || 0,
    allowedEvaluations: Number(row.allowed_evaluations) || 0,
    allowedFineTuneResume: Number(row.allowed_fine_tune_resume) || 0,
    allowedFineTuneCover: Number(row.allowed_fine_tune_cover) || 0,
    usedSearches: Number(row.used_searches) || 0,
    usedEvaluations: Number(row.used_evaluations) || 0,
    usedFineTuneResume: Number(row.used_fine_tune_resume) || 0,
    usedFineTuneCover: Number(row.used_fine_tune_cover) || 0,
    periodStartedAt: String(row.period_started_at ?? new Date().toISOString()),
    periodEndsAt: row.period_ends_at ? String(row.period_ends_at) : null,
  };
}

/**
 * Reconcile the ledger's allowed counts with the profile's CURRENT plan.
 * Called on profile load so a plan change (from a webhook) is reflected in
 * the ledger even if the reset/update write was missed.
 */
export async function syncEntitlementsLedger(
  userId: string,
  profile: Profile,
): Promise<EntitlementsLedger | null> {
  const effectivePlan: Plan = profile.role === "admin" ? "pro" : profile.plan;
  const ledger = await getEntitlementsLedger(userId, effectivePlan);
  if (!ledger) return null;

  const supabase = requireServiceClient();
  const allowance = planAllowance(effectivePlan);
  const changed =
    ledger.plan !== effectivePlan ||
    ledger.allowedSearches !== allowance.searches ||
    ledger.allowedEvaluations !== allowance.evaluations ||
    ledger.allowedFineTuneResume !== allowance.fineTuneResume ||
    ledger.allowedFineTuneCover !== allowance.fineTuneCoverLetter;

  if (changed) {
    const now = new Date().toISOString();
    await supabase
      .from("entitlements")
      .update({
        plan: effectivePlan,
        allowed_searches: allowance.searches,
        allowed_evaluations: allowance.evaluations,
        allowed_fine_tune_resume: allowance.fineTuneResume,
        allowed_fine_tune_cover: allowance.fineTuneCoverLetter,
        // Plan changed → reset the used counters for the new period.
        used_searches: 0,
        used_evaluations: 0,
        used_fine_tune_resume: 0,
        used_fine_tune_cover: 0,
        period_started_at: now,
        updated_at: now,
      })
      .eq("user_id", userId);
    return {
      ...ledger,
      plan: effectivePlan,
      allowedSearches: allowance.searches,
      allowedEvaluations: allowance.evaluations,
      allowedFineTuneResume: allowance.fineTuneResume,
      allowedFineTuneCover: allowance.fineTuneCoverLetter,
      usedSearches: 0,
      usedEvaluations: 0,
      usedFineTuneResume: 0,
      usedFineTuneCover: 0,
      periodStartedAt: now,
    };
  }

  // ── Reconcile used counters from usage_records (source of truth) ──
  // The ledger is a fast-read cache; the authoritative count lives in
  // usage_records. If they disagree (e.g. a bump failed before the RPC fix,
  // or a row was refunded), correct the ledger so the Profile page is always
  // accurate. Runs on every getEntitlements (cheap: one indexed query).
  const records = await getUsageRecords(userId, profile.usagePeriodStart);
  const actual = {
    searches: records.filter((r) => r.usage_type === "search").length,
    evaluations: records.filter((r) => r.usage_type === "evaluation").length,
    fineTuneResume: records.filter((r) => r.usage_type === "fine_tune_resume")
      .length,
    fineTuneCoverLetter: records.filter(
      (r) => r.usage_type === "fine_tune_cover_letter",
    ).length,
  };
  const usageDrifted =
    ledger.usedSearches !== actual.searches ||
    ledger.usedEvaluations !== actual.evaluations ||
    ledger.usedFineTuneResume !== actual.fineTuneResume ||
    ledger.usedFineTuneCover !== actual.fineTuneCoverLetter;

  if (usageDrifted) {
    await supabase
      .from("entitlements")
      .update({
        used_searches: actual.searches,
        used_evaluations: actual.evaluations,
        used_fine_tune_resume: actual.fineTuneResume,
        used_fine_tune_cover: actual.fineTuneCoverLetter,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return {
      ...ledger,
      usedSearches: actual.searches,
      usedEvaluations: actual.evaluations,
      usedFineTuneResume: actual.fineTuneResume,
      usedFineTuneCover: actual.fineTuneCoverLetter,
    };
  }

  return ledger;
}

/* ── Profile ───────────────────────────────────────────────────── */

export type Profile = {
  role: Role;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId: string | null;
  usagePeriodStart: string;
  currentPeriodEnd: string | null;
};

/** Read the user's profile row (role + plan + stripe state), creating it if absent. */
export async function getProfile(
  userId: string,
  email?: string | null,
): Promise<Profile> {
  const isAdmin =
    email != null &&
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.trim().toLowerCase());

  const supabase = requireServiceClient();
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    const role = isAdmin ? "admin" : ((existing.role as Role) ?? "user");
    if (role !== existing.role) {
      await supabase.from("profiles").update({ role }).eq("user_id", userId);
    }
    return {
      role,
      plan: (existing.plan as Plan) ?? "free",
      subscriptionStatus:
        (existing.subscription_status as SubscriptionStatus) ?? "none",
      stripeCustomerId: (existing.stripe_customer_id as string | null) ?? null,
      usagePeriodStart:
        (existing.usage_period_start as string | null) ??
        new Date().toISOString(),
      currentPeriodEnd: (existing.current_period_end as string | null) ?? null,
    };
  }

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      user_id: userId,
      email: email ?? null,
      role: isAdmin ? "admin" : "user",
      plan: "free",
      subscription_status: "none",
    })
    .select()
    .maybeSingle();

  if (error) {
    const { data: retry } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return retry
      ? {
          role: isAdmin ? "admin" : ((retry.role as Role) ?? "user"),
          plan: (retry.plan as Plan) ?? "free",
          subscriptionStatus:
            (retry.subscription_status as SubscriptionStatus) ?? "none",
          stripeCustomerId: (retry.stripe_customer_id as string | null) ?? null,
          usagePeriodStart:
            (retry.usage_period_start as string | null) ??
            new Date().toISOString(),
          currentPeriodEnd: (retry.current_period_end as string | null) ?? null,
        }
      : {
          role: isAdmin ? "admin" : "user",
          plan: "free",
          subscriptionStatus: "none",
          stripeCustomerId: null,
          usagePeriodStart: new Date().toISOString(),
          currentPeriodEnd: null,
        };
  }

  return {
    role: (created.role as Role) ?? (isAdmin ? "admin" : "user"),
    plan: (created.plan as Plan) ?? "free",
    subscriptionStatus:
      (created.subscription_status as SubscriptionStatus) ?? "none",
    stripeCustomerId: (created.stripe_customer_id as string | null) ?? null,
    usagePeriodStart:
      (created.usage_period_start as string | null) ?? new Date().toISOString(),
    currentPeriodEnd: (created.current_period_end as string | null) ?? null,
  };
}

/** A subscription is "active" while the user can actually use paid features. */
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "paused"
  );
}

/**
 * Effective limits for a profile.
 * Admin → unlimited. Otherwise the plan's limits apply only when the
 * subscription is active; a canceled/expired paid plan falls back to free.
 */
export function getLimitsForProfile(profile: Profile): PlanLimits {
  if (profile.role === "admin") return ADMIN_LIMITS;
  if (profile.plan === "free") return PLAN_DEFS.free.limits;
  // Paid plan but not active → treat as free until the subscription is restored.
  if (!isSubscriptionActive(profile.subscriptionStatus))
    return PLAN_DEFS.free.limits;
  return PLAN_DEFS[profile.plan].limits;
}

/** True if the user is effectively unlimited. */
export function isUnlimited(profile: Profile): boolean {
  return getLimitsForProfile(profile).unlimited;
}

/* ── Usage (current period) ───────────────────────────────────── */

/** Query the user's usage rows within the current usage period. */
async function getUsageRecords(userId: string, periodStart: string) {
  const supabase = requireServiceClient();
  const { data, error } = await supabase
    .from("usage_records")
    .select("usage_type, search_key, created_at")
    .eq("user_id", userId)
    .gte("created_at", periodStart);
  if (error) {
    console.error("[entitlements] usage query error:", error.message);
    return [];
  }
  return (data ?? []) as {
    usage_type: UsageType;
    search_key: string | null;
    created_at: string;
  }[];
}

/**
 * Read the user's full entitlement summary for the UI + gating.
 * `email` is only used to bootstrap the admin role on first profile create.
 *
 * The summary's allowed/used numbers come from the `entitlements` ledger
 * (maintained by the backend Azure Functions + Stripe webhook). Per-key
 * free-tier counts are still derived from `usage_records`.
 */
export async function getEntitlements(
  email?: string | null,
): Promise<EntitlementSummary | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const profile = await getProfile(userId, email);
  const limits = getLimitsForProfile(profile);
  const ledger = await syncEntitlementsLedger(userId, profile);

  // Per-key free-tier usage still comes from the audit rows.
  const records = await getUsageRecords(userId, profile.usagePeriodStart);
  const searchesByKey: Record<string, number> = {};
  const evaluationsByKey: Record<string, number> = {};
  for (const r of records) {
    const k = usageKey(r.search_key);
    if (r.usage_type === "search")
      searchesByKey[k] = (searchesByKey[k] ?? 0) + 1;
    else if (r.usage_type === "evaluation")
      evaluationsByKey[k] = (evaluationsByKey[k] ?? 0) + 1;
  }

  // Prefer the ledger's used counters (backend-authoritative); fall back to
  // counting audit rows if the ledger is missing. For FREE plans, searches/
  // evaluations are PER-KEY (1 per keyword, unlimited distinct keys) — so the
  // "used" is the number of DISTINCT keys searched/evaluated, not the total
  // row count (which would inflate when the same key is re-run).
  const isFree =
    profile.plan === "free" ||
    !isSubscriptionActive(profile.subscriptionStatus);
  const searches = isFree
    ? Object.keys(searchesByKey).length
    : (ledger?.usedSearches ??
      records.filter((r) => r.usage_type === "search").length);
  const evaluations = isFree
    ? Object.keys(evaluationsByKey).length
    : (ledger?.usedEvaluations ??
      records.filter((r) => r.usage_type === "evaluation").length);
  const fineTuneResume =
    ledger?.usedFineTuneResume ??
    records.filter((r) => r.usage_type === "fine_tune_resume").length;
  const fineTuneCoverLetter =
    ledger?.usedFineTuneCover ??
    records.filter((r) => r.usage_type === "fine_tune_cover_letter").length;

  return {
    role: profile.role,
    plan: profile.plan,
    subscriptionStatus: profile.subscriptionStatus,
    planLabel:
      profile.role === "admin"
        ? "Admin"
        : (PLAN_DEFS[profile.plan]?.label ?? "Free"),
    limits,
    usage: {
      searches,
      evaluations,
      fineTuneResume,
      fineTuneCoverLetter,
      searchesByKey,
      evaluationsByKey,
    },
    periodStart: ledger?.periodStartedAt ?? profile.usagePeriodStart,
    periodEnd: ledger?.periodEndsAt ?? profile.currentPeriodEnd,
  };
}

/* ── Consume entitlements (check + record atomically) ─────────── */

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "unauthorized" | "limit_reached"; message: string };

/**
 * Check the user's entitlement within the current usage period (frontend
 * GATE ONLY). For free users the limit is per-search-key (lifetime); for
 * standard/pro the limit is a monthly total.
 *
 * IMPORTANT: This does NOT insert a usage_records row — the backend Azure
 * Functions are the single writer of usage (they deduct when the operation
 * actually runs). The frontend calls this to disable buttons early and to
 * surface a friendly "limit reached" message before hitting the network.
 *
 * @param type   which quota to check
 * @param opts.searchKey optional search key (free per-key limit)
 */
export async function consumeEntitlement(
  type: UsageType,
  opts?: { searchKey?: string | null },
): Promise<ConsumeResult> {
  const userId = await getUserId();
  if (!userId)
    return { ok: false, reason: "unauthorized", message: "Not authenticated." };

  const profile = await getProfile(userId);
  const limits = getLimitsForProfile(profile);

  // Unlimited → never blocked (the backend records for unlimited too).
  if (limits.unlimited) {
    return { ok: true };
  }

  const records = await getUsageRecords(userId, profile.usagePeriodStart);
  const key = usageKey(opts?.searchKey);

  const countFor = (t: UsageType, k?: string) =>
    records.filter(
      (r) =>
        r.usage_type === t && (k === undefined || usageKey(r.search_key) === k),
    ).length;

  const planName =
    profile.role === "admin"
      ? "Admin"
      : profile.plan === "pro"
        ? "Pro"
        : profile.plan === "standard"
          ? "Standard"
          : "Free";

  let limitMsg: string | null = null;

  switch (type) {
    case "search": {
      if (profile.plan === "free") {
        if (countFor("search") >= FREE_SEARCH_LIMIT) {
          limitMsg =
            "You've used your free search. Upgrade to Standard or Pro for more.";
        }
      } else if (countFor("search") >= limits.monthly.searches) {
        limitMsg = `You've used all ${limits.monthly.searches} searches for this month on ${planName}. They reset next billing cycle.`;
      }
      break;
    }
    case "evaluation": {
      if (profile.plan === "free") {
        if (countFor("evaluation") >= FREE_EVALUATION_LIMIT) {
          limitMsg =
            "You've used your free evaluation. Upgrade to Standard or Pro for more.";
        }
      } else if (countFor("evaluation") >= limits.monthly.evaluations) {
        limitMsg = `You've used all ${limits.monthly.evaluations} evaluations for this month on ${planName}. They reset next billing cycle.`;
      }
      break;
    }
    case "fine_tune_resume": {
      const used = countFor("fine_tune_resume");
      const max =
        profile.plan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : limits.monthly.fineTuneResume;
      if (used >= max) {
        limitMsg =
          profile.plan === "free"
            ? "You've used your free resume fine-tune. Upgrade to Standard or Pro for more."
            : `You've used all ${max} resume fine-tunes for this month on ${planName}. They reset next billing cycle.`;
      }
      break;
    }
    case "fine_tune_cover_letter": {
      const used = countFor("fine_tune_cover_letter");
      const max =
        profile.plan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : limits.monthly.fineTuneCoverLetter;
      if (used >= max) {
        limitMsg =
          profile.plan === "free"
            ? "You've used your free cover-letter fine-tune. Upgrade to Standard or Pro for more."
            : `You've used all ${max} cover-letter fine-tunes for this month on ${planName}. They reset next billing cycle.`;
      }
      break;
    }
  }

  if (limitMsg) {
    return { ok: false, reason: "limit_reached", message: limitMsg };
  }

  return { ok: true };
}
