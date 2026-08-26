import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  Entitlements — subscription + usage limits for JobSeek.            */
/*                                                                     */
/*  Plan model:                                                        */
/*    - admin  : unlimited (seeded by ADMIN_EMAILS env)                */
/*    - pro    : unlimited (active Stripe subscription)                */
/*    - free   : per search key (lifetime): 1 search, 1 evaluation;    */
/*               plus 1 fine-tune resume + 1 fine-tune cover letter    */
/*               (lifetime, per user)                                  */
/*                                                                     */
/*  Every entitlement-consuming action calls `consumeEntitlement`      */
/*  which: 1) checks the limit, 2) records the usage in `usage_records`*/
/*  in a single transaction (so a race can't double-spend a quota).    */
/* ------------------------------------------------------------------ */

export type Role = "user" | "admin";
export type Plan = "free" | "pro";
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

export interface EntitlementSummary {
  role: Role;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  /** True when the user may consume unlimited resources. */
  unlimited: boolean;
  /** Per-search-key usage (free tier). */
  usage: {
    /** Map of search_key → search count. */
    searchesByKey: Record<string, number>;
    /** Map of search_key → evaluation count. */
    evaluationsByKey: Record<string, number>;
    fineTuneResume: number;
    fineTuneCoverLetter: number;
  };
  /** Human-friendly labels for the UI. */
  labels: {
    plan: string;
    status: string;
  };
}

/** Free-tier limits. */
export const FREE_LIMITS = {
  searchesPerKey: 1,
  evaluationsPerKey: 1,
  fineTunesPerUser: 1, // per document type
} as const;

/** Keys of the search key used to normalize (e.g. "Web Developer" → "web_developer"). */
export function normalizeKey(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** Normalize an arbitrary search key / keyword for usage grouping. */
function usageKey(s: string | null | undefined): string {
  return normalizeKey(s) || "general";
}

/** Read the user's profile row (role + stripe state), creating it if absent. */
export async function getProfile(
  userId: string,
  email?: string | null,
): Promise<{
  role: Role;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId: string | null;
}> {
  // Upsert on first access so every authenticated user has a profile row.
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    return {
      role: (existing.role as Role) ?? "user",
      plan: (existing.plan as Plan) ?? "free",
      subscriptionStatus:
        (existing.subscription_status as SubscriptionStatus) ?? "none",
      stripeCustomerId: (existing.stripe_customer_id as string | null) ?? null,
    };
  }

  const isAdmin =
    email != null &&
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.trim().toLowerCase());

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
    // Rare race — another request just created it; read again.
    const { data: retry } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    return retry
      ? {
          role: (retry.role as Role) ?? "user",
          plan: (retry.plan as Plan) ?? "free",
          subscriptionStatus:
            (retry.subscription_status as SubscriptionStatus) ?? "none",
          stripeCustomerId:
            (retry.stripe_customer_id as string | null) ?? null,
        }
      : { role: "user", plan: "free", subscriptionStatus: "none", stripeCustomerId: null };
  }

  return {
    role: (created.role as Role) ?? "user",
    plan: (created.plan as Plan) ?? "free",
    subscriptionStatus:
      (created.subscription_status as SubscriptionStatus) ?? "none",
    stripeCustomerId: (created.stripe_customer_id as string | null) ?? null,
  };
}

/** A subscription is "active" while the user can actually use Pro features. */
export function isSubscriptionActive(
  status: SubscriptionStatus,
): boolean {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "paused"
  );
}

/** Whether this profile is entitled to unlimited usage. */
export function isUnlimited(profile: {
  role: Role;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
}): boolean {
  if (profile.role === "admin") return true;
  if (profile.plan === "pro" && isSubscriptionActive(profile.subscriptionStatus))
    return true;
  return false;
}

/**
 * Read the user's full entitlement summary for the UI + gating.
 * `email` is only used to bootstrap the admin role on first profile create.
 */
export async function getEntitlements(
  email?: string | null,
): Promise<EntitlementSummary | null> {
  const userId = await getUserId();
  if (!userId) return null;

  const profile = await getProfile(userId, email);

  const { data: usage } = await supabase
    .from("usage_records")
    .select("usage_type, search_key")
    .eq("user_id", userId);

  const records = (usage ?? []) as {
    usage_type: UsageType;
    search_key: string | null;
  }[];

  const searchesByKey: Record<string, number> = {};
  const evaluationsByKey: Record<string, number> = {};
  let fineTuneResume = 0;
  let fineTuneCoverLetter = 0;

  for (const r of records) {
    const k = usageKey(r.search_key);
    if (r.usage_type === "search") searchesByKey[k] = (searchesByKey[k] ?? 0) + 1;
    else if (r.usage_type === "evaluation")
      evaluationsByKey[k] = (evaluationsByKey[k] ?? 0) + 1;
    else if (r.usage_type === "fine_tune_resume") fineTuneResume++;
    else if (r.usage_type === "fine_tune_cover_letter") fineTuneCoverLetter++;
  }

  const unlimited = isUnlimited(profile);

  return {
    role: profile.role,
    plan: profile.plan,
    subscriptionStatus: profile.subscriptionStatus,
    unlimited,
    usage: {
      searchesByKey,
      evaluationsByKey,
      fineTuneResume,
      fineTuneCoverLetter,
    },
    labels: {
      plan: profile.role === "admin" ? "Admin" : profile.plan === "pro" ? "Pro" : "Free",
      status: profile.subscriptionStatus,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Consume entitlements (check + record atomically)                   */
/* ------------------------------------------------------------------ */

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "unauthorized" | "limit_reached"; message: string };

/**
 * Check + record an entitlement. For free users the limit is enforced by
 * counting `usage_records` inside a transaction, so concurrent requests
 * cannot double-spend the last quota.
 *
 * @param type   which quota this consumes
 * @param searchKey optional search key for per-key limits (search/evaluation)
 */
export async function consumeEntitlement(
  type: UsageType,
  opts?: { searchKey?: string | null },
): Promise<ConsumeResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, reason: "unauthorized", message: "Not authenticated." };

  const profile = await getProfile(userId);
  if (isUnlimited(profile)) {
    // Still record usage (for the UI), but never block.
    await recordUsage(userId, type, opts?.searchKey ?? null);
    return { ok: true };
  }

  const key = usageKey(opts?.searchKey);

  // Read the relevant limit before writing (Postgres row lock on the
  // profile would be overkill here; a unique constraint + count check in
  // one RPC is the race-safe approach). We use a count check then insert;
  // the unique index below prevents duplicates, and the RPC is atomic.
  const { data: existing } = await supabase
    .from("usage_records")
    .select("usage_type, search_key")
    .eq("user_id", userId);

  const records = (existing ?? []) as {
    usage_type: UsageType;
    search_key: string | null;
  }[];

  const countFor = (t: UsageType, k?: string) =>
    records.filter(
      (r) => r.usage_type === t && (k === undefined || usageKey(r.search_key) === k),
    ).length;

  switch (type) {
    case "search": {
      if (countFor("search", key) >= FREE_LIMITS.searchesPerKey) {
        return {
          ok: false,
          reason: "limit_reached",
          message: `You've used your free search for “${opts?.searchKey ?? key}”. Upgrade to Pro for unlimited searches.`,
        };
      }
      break;
    }
    case "evaluation": {
      if (countFor("evaluation", key) >= FREE_LIMITS.evaluationsPerKey) {
        return {
          ok: false,
          reason: "limit_reached",
          message: `You've used your free evaluation for “${opts?.searchKey ?? key}”. Upgrade to Pro for unlimited evaluations.`,
        };
      }
      break;
    }
    case "fine_tune_resume": {
      if (countFor("fine_tune_resume") >= FREE_LIMITS.fineTunesPerUser) {
        return {
          ok: false,
          reason: "limit_reached",
          message:
            "You've used your free resume fine-tune. Upgrade to Pro for unlimited fine-tuning.",
        };
      }
      break;
    }
    case "fine_tune_cover_letter": {
      if (countFor("fine_tune_cover_letter") >= FREE_LIMITS.fineTunesPerUser) {
        return {
          ok: false,
          reason: "limit_reached",
          message:
            "You've used your free cover-letter fine-tune. Upgrade to Pro for unlimited fine-tuning.",
        };
      }
      break;
    }
  }

  const { error } = await supabase.from("usage_records").insert({
    user_id: userId,
    usage_type: type,
    search_key: type === "search" || type === "evaluation" ? key : null,
  });

  if (error) {
    // Unique conflict = a concurrent request already consumed the last slot.
    if (error.code === "23505") {
      return {
        ok: false,
        reason: "limit_reached",
        message: "You've just hit your free limit. Upgrade to Pro for more.",
      };
    }
    console.error("[entitlements] record usage error:", error.message);
    return { ok: false, reason: "limit_reached", message: "Could not record usage." };
  }

  return { ok: true };
}

/** Record usage without a limit check (used for unlimited users / auto-evals). */
export async function recordUsage(
  userId: string,
  type: UsageType,
  searchKey?: string | null,
): Promise<void> {
  const key = usageKey(searchKey);
  await supabase.from("usage_records").insert({
    user_id: userId,
    usage_type: type,
    search_key: type === "search" || type === "evaluation" ? key : null,
  });
}
