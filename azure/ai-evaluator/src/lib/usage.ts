import { getSupabase } from "./supabase.js";

/**
 * Authoritative server-side usage tracking + enforcement for the evaluator.
 *
 * The frontend ALSO checks usage (lib/entitlements.ts) to disable buttons,
 * but recording must happen HERE so the backend is the single writer. Every
 * backend entry point that consumes quota (evaluate, generateDocument) calls
 * `consumeUsage` which:
 *   1. loads the profile (plan / subscription / period start),
 *   2. counts usage within the current period,
 *   3. blocks if the limit is reached (fail-closed),
 *   4. otherwise INSERTs a `usage_records` row (the deduction) stamped with
 *      the effective plan.
 *
 * Race safety: free-tier per-key limits use a PARTIAL UNIQUE INDEX on
 * (user_id, usage_type, search_key) WHERE plan='free' — a concurrent
 * double-click hits 23505 and is rejected. Paid monthly limits just count
 * rows (multiple rows per key are allowed so re-searching a keyword to get
 * the NEXT page of results works).
 *
 * Deduct only when actually used: `consumeUsage` returns the inserted row id;
 * if the downstream enqueue fails, call `refundUsage(userId, type, searchKey)`
 * to delete the just-inserted row.
 *
 * Quota model (mirrors lib/entitlements.ts in the Next app):
 *   free     : lifetime — 1 search + 1 eval per search key, 1 fine-tune each
 *   standard : 150 HKD/mo — 30 search / 30 eval / 30 fine-tune each
 *   pro      : 300 HKD/mo — 70 search / 70 eval / 70 fine-tune each
 *   admin    : unlimited
 *
 * Monthly reset: only usage_records rows with created_at >= the profile's
 * `usage_period_start` count toward the quota. Rows are retained for audit.
 */

export type UsageType =
  | "search"
  | "evaluation"
  | "fine_tune_resume"
  | "fine_tune_cover_letter";

export type UsageResult =
  | { ok: true; id?: string | null }
  | { ok: false; reason: "not_found" | "limit_reached"; message: string };

const FREE_SEARCH_LIMIT = 1; // lifetime, TOTAL (not per-key)
const FREE_EVALUATION_LIMIT = 1; // lifetime, TOTAL (not per-key)
const FREE_FINE_TUNE_LIMIT = 1;

const PLAN_LIMITS: Record<
  string,
  {
    searches: number;
    evaluations: number;
    fineTuneResume: number;
    fineTuneCoverLetter: number;
  }
> = {
  standard: {
    searches: 30,
    evaluations: 30,
    fineTuneResume: 30,
    fineTuneCoverLetter: 30,
  },
  pro: {
    searches: 70,
    evaluations: 70,
    fineTuneResume: 70,
    fineTuneCoverLetter: 70,
  },
};

function normalizeKey(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** Fetch the user's profile row, lazily CREATING a default free profile if absent. */
export async function getProfileForUser(userId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("profiles")
    .select(
      "role, plan, subscription_status, usage_period_start, current_period_end",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }
  if (data) {
    return data as {
      role: string | null;
      plan: string | null;
      subscription_status: string | null;
      usage_period_start: string | null;
      current_period_end: string | null;
    };
  }
  // No profile yet (brand-new user who never opened the Profile page) →
  // create a default free profile so their first action isn't blocked.
  const now = new Date().toISOString();
  const { data: created, error: createErr } = await sb
    .from("profiles")
    .insert({
      user_id: userId,
      role: "user",
      plan: "free",
      subscription_status: "none",
      usage_period_start: now,
    })
    .select(
      "role, plan, subscription_status, usage_period_start, current_period_end",
    )
    .maybeSingle();
  if (createErr && createErr.code !== "23505") {
    throw new Error(`Failed to create profile: ${createErr.message}`);
  }
  if (created) {
    return created as {
      role: string | null;
      plan: string | null;
      subscription_status: string | null;
      usage_period_start: string | null;
      current_period_end: string | null;
    };
  }
  // A concurrent insert won — re-read.
  const { data: retry } = await sb
    .from("profiles")
    .select(
      "role, plan, subscription_status, usage_period_start, current_period_end",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return (retry ?? null) as {
    role: string | null;
    plan: string | null;
    subscription_status: string | null;
    usage_period_start: string | null;
    current_period_end: string | null;
  } | null;
}

/** A subscription is "active" while the user can actually use paid features. */
function isActive(status: string | null | undefined): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "paused"
  );
}

/** Count the user's usage of a type within the current period. */
async function countUsage(
  userId: string,
  type: UsageType,
  periodStart: string,
  searchKey?: string,
): Promise<number> {
  const sb = getSupabase();
  let q = sb
    .from("usage_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("usage_type", type)
    .gte("created_at", periodStart);
  if (searchKey) q = q.eq("search_key", searchKey);
  const { count, error } = await q;
  if (error) throw new Error(`Failed to count usage: ${error.message}`);
  return count ?? 0;
}

/**
 * Enforce the user's plan limit for `type` and, if allowed, record a
 * `usage_records` row (the deduction) stamped with the effective plan.
 *
 * The insert is atomic: for free users the partial unique index on
 * (user_id, usage_type, search_key) WHERE plan='free' makes a concurrent
 * double-spend of the last slot hit a 23505 (treated as a limit).
 *
 * Returns `{ ok: false, reason: "not_found" }` if the profile row is missing
 * (caller should decide whether to treat that as free or block).
 */
export async function consumeUsage(
  userId: string,
  type: UsageType,
  opts?: { searchKey?: string | null },
): Promise<UsageResult> {
  const profile = await getProfileForUser(userId);
  if (!profile) {
    return { ok: false, reason: "not_found", message: "Profile not found." };
  }

  // Admin → record but never block.
  if (profile.role === "admin") {
    const id = await insertUsage(
      userId,
      type,
      opts?.searchKey ?? null,
      "admin",
    );
    await bumpLedger(userId, type).catch(() => {});
    return { ok: true, id };
  }

  const plan = profile.plan ?? "free";
  const active = isActive(profile.subscription_status);
  // Paid plan but not active → treat as free until subscription is restored.
  const effectivePlan = plan !== "free" && !active ? "free" : plan;

  const periodStart = profile.usage_period_start ?? new Date().toISOString();
  const key = normalizeKey(opts?.searchKey) || "general";

  switch (type) {
    case "search": {
      if (effectivePlan === "free") {
        const used = await countUsage(userId, "search", periodStart);
        if (used >= FREE_SEARCH_LIMIT)
          return {
            ok: false,
            reason: "limit_reached",
            message:
              "You've used your free search. Upgrade to Standard or Pro for more.",
          };
      } else {
        const max = PLAN_LIMITS[effectivePlan]?.searches ?? 0;
        const used = await countUsage(userId, "search", periodStart);
        if (used >= max)
          return {
            ok: false,
            reason: "limit_reached",
            message: `You've used all ${max} searches for this month. They reset next billing cycle.`,
          };
      }
      break;
    }
    case "evaluation": {
      if (effectivePlan === "free") {
        const used = await countUsage(userId, "evaluation", periodStart);
        if (used >= FREE_EVALUATION_LIMIT)
          return {
            ok: false,
            reason: "limit_reached",
            message:
              "You've used your free evaluation. Upgrade to Standard or Pro for more.",
          };
      } else {
        const max = PLAN_LIMITS[effectivePlan]?.evaluations ?? 0;
        const used = await countUsage(userId, "evaluation", periodStart);
        if (used >= max)
          return {
            ok: false,
            reason: "limit_reached",
            message: `You've used all ${max} evaluations for this month. They reset next billing cycle.`,
          };
      }
      break;
    }
    case "fine_tune_resume": {
      const max =
        effectivePlan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : (PLAN_LIMITS[effectivePlan]?.fineTuneResume ?? 0);
      const used = await countUsage(userId, "fine_tune_resume", periodStart);
      if (used >= max)
        return {
          ok: false,
          reason: "limit_reached",
          message:
            effectivePlan === "free"
              ? "You've used your free resume fine-tune. Upgrade to Standard or Pro for more."
              : `You've used all ${max} resume fine-tunes for this month. They reset next billing cycle.`,
        };
      break;
    }
    case "fine_tune_cover_letter": {
      const max =
        effectivePlan === "free"
          ? FREE_FINE_TUNE_LIMIT
          : (PLAN_LIMITS[effectivePlan]?.fineTuneCoverLetter ?? 0);
      const used = await countUsage(
        userId,
        "fine_tune_cover_letter",
        periodStart,
      );
      if (used >= max)
        return {
          ok: false,
          reason: "limit_reached",
          message:
            effectivePlan === "free"
              ? "You've used your free cover-letter fine-tune. Upgrade to Standard or Pro for more."
              : `You've used all ${max} cover-letter fine-tunes for this month. They reset next billing cycle.`,
        };
      break;
    }
  }

  // Record the deduction (with the effective plan for the partial index).
  const id = await insertUsage(userId, type, key, effectivePlan);
  // Keep the fast-read ledger in sync (non-fatal).
  await bumpLedger(userId, type).catch(() => {});
  return { ok: true, id };
}

/** Sentinel so callers can distinguish a race-limit from a hard error. */
export class UsageLimitReachedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageLimitReachedError";
  }
}

/** Insert a usage row, returning its id. Throws UsageLimitReachedError on a unique violation. */
async function insertUsage(
  userId: string,
  type: UsageType,
  searchKey: string | null,
  plan: string,
): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("usage_records")
    .insert({
      user_id: userId,
      usage_type: type,
      search_key: type === "search" || type === "evaluation" ? searchKey : null,
      plan,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new UsageLimitReachedError(
        "You've just hit your limit. Upgrade to Standard or Pro for more.",
      );
    }
    throw new Error(`Failed to record usage: ${error.message}`);
  }
  return (data?.id as string | null) ?? null;
}

/**
 * Undo a deduction when the downstream operation failed (e.g. Service Bus
 * enqueue errored). Deletes the just-inserted usage row (scoped to the last
 * 2 minutes so it can never remove an old, legitimate row).
 */
export async function refundUsage(
  userId: string,
  type: UsageType,
  searchKey?: string | null,
): Promise<void> {
  const key = normalizeKey(searchKey) || "general";
  const now = new Date();
  await getSupabase()
    .from("usage_records")
    .delete()
    .eq("user_id", userId)
    .eq("usage_type", type)
    .eq("search_key", type === "search" || type === "evaluation" ? key : null)
    .gte("created_at", new Date(now.getTime() - 120_000).toISOString())
    .lte("created_at", new Date(now.getTime() + 5_000).toISOString());
  await decrementLedger(userId, type);
}

/**
 * Increment the user's `entitlements` ledger used-counter for `type`.
 * Lazily creates the ledger row (default free) if it doesn't exist yet.
 * Non-fatal — the `usage_records` insert is the source of truth; if the
 * ledger bump fails we log and continue.
 */
export async function bumpLedger(
  userId: string,
  type: UsageType,
): Promise<void> {
  const column = ledgerColumnFor(type);
  if (!column) return;
  const sb = getSupabase();
  // Ensure the row exists (best-effort).
  await ensureLedgerRow(userId);
  const { error } = await sb.rpc("bump_entitlement", {
    p_user_id: userId,
    p_column: column,
  });
  if (error) {
    console.warn(`[usage] ledger bump failed (${column}): ${error.message}`);
  }
}

/** Decrement the ledger used-counter (used on refund). Non-fatal. */
export async function decrementLedger(
  userId: string,
  type: UsageType,
): Promise<void> {
  const column = ledgerColumnFor(type);
  if (!column) return;
  const { error } = await getSupabase().rpc("bump_entitlement", {
    p_user_id: userId,
    p_column: column,
    p_delta: -1,
  });
  if (error) {
    console.warn(
      `[usage] ledger decrement failed (${column}): ${error.message}`,
    );
  }
}

/** Map a usage type to its ledger used_* column. */
function ledgerColumnFor(type: UsageType): string | null {
  switch (type) {
    case "search":
      return "used_searches";
    case "evaluation":
      return "used_evaluations";
    case "fine_tune_resume":
      return "used_fine_tune_resume";
    case "fine_tune_cover_letter":
      return "used_fine_tune_cover";
    default:
      return null;
  }
}

/** Ensure an entitlements ledger row exists (lazy create, default free). */
async function ensureLedgerRow(userId: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from("entitlements")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || data) return;
  const now = new Date().toISOString();
  const { error: insertErr } = await getSupabase().from("entitlements").insert({
    user_id: userId,
    plan: "free",
    // Free plan privileges: 1 each.
    allowed_searches: 1,
    allowed_evaluations: 1,
    allowed_fine_tune_resume: 1,
    allowed_fine_tune_cover: 1,
    used_searches: 0,
    used_evaluations: 0,
    used_fine_tune_resume: 0,
    used_fine_tune_cover: 0,
    period_started_at: now,
  });
  if (insertErr && insertErr.code !== "23505") {
    console.warn(`[usage] ledger row create failed: ${insertErr.message}`);
  }
}

/** Record usage without a limit check (unlimited users / backend re-assertion). */
export async function recordUsage(
  userId: string,
  type: UsageType,
  searchKey?: string | null,
  plan = "free",
): Promise<void> {
  const key = normalizeKey(searchKey) || "general";
  await getSupabase()
    .from("usage_records")
    .insert({
      user_id: userId,
      usage_type: type,
      search_key: type === "search" || type === "evaluation" ? key : null,
      plan,
    });
}
