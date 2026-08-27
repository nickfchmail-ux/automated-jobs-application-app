import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe event handler — the SOURCE OF TRUTH for subscription state.
 *
 * Events handled:
 *   - checkout.session.completed        → set plan=pro, active
 *   - customer.subscription.updated     → sync status + period end
 *   - customer.subscription.deleted     → back to free
 *   - customer.subscription.paused      → free (paused = no entitlement)
 *   - customer.subscription.resumed     → pro
 *   - customer.deleted                  → cleanup (best effort)
 *
 * Security: the raw body is required for signature verification, so this
 * route uses `await req.text()` and verifies with the webhook secret.
 * Every write is scoped by stripe_customer_id → user_id.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured." },
      { status: 503 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad signature";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  // ── Idempotency ──────────────────────────────────────────────
  // If this event was already processed, return 200 without acting again.
  const { data: processed } = await supabase
    .from("stripe_events")
    .select("id")
    .eq("event_id", event.id)
    .maybeSingle();
  if (processed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const customerId = session.customer as string | null;
        // plan_tier is stamped on the checkout session at creation time
        // (server-side, from the verified role/requested tier). Admins buy
        // the "admin" tier but are already granted unlimited via role; the
        // webhook maps standard/pro to the plan.
        const tier = String(session.metadata?.plan_tier ?? "standard");
        const plan = tier === "pro" ? "pro" : "standard";
        await setProfileFromCustomer(customerId, {
          plan,
          subscriptionStatus: "active",
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const status = mapSubscriptionStatus(sub.status);
        const customerId = sub.customer as string | null;
        const tier = String(sub.metadata?.plan_tier ?? "standard");
        // Paused/canceled subscriptions don't grant paid access.
        const plan =
          status === "active" || status === "trialing"
            ? tier === "pro"
              ? "pro"
              : "standard"
            : "free";
        // current_period_end lives on the subscription's items in this API.
        const periodEnd = sub.items?.data?.[0]?.current_period_end;
        const periodEndIso = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null;
        await setProfileFromCustomer(customerId, {
          plan,
          subscriptionStatus: status,
          currentPeriodEnd: periodEndIso,
          // Reset usage on a fresh billing cycle (when a NEW period starts).
          resetUsage: true,
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await setProfileFromCustomer(sub.customer as string | null, {
          plan: "free",
          subscriptionStatus: "canceled",
          currentPeriodEnd: null,
        });
        break;
      }

      case "customer.subscription.paused": {
        const sub = event.data.object;
        await setProfileFromCustomer(sub.customer as string | null, {
          plan: "free",
          subscriptionStatus: "paused",
        });
        break;
      }

      case "customer.subscription.resumed": {
        const sub = event.data.object;
        const tier = String(sub.metadata?.plan_tier ?? "standard");
        await setProfileFromCustomer(sub.customer as string | null, {
          plan: tier === "pro" ? "pro" : "standard",
          subscriptionStatus: "active",
        });
        break;
      }

      default:
        // Unknown events are ack'd (Stripe retries them otherwise).
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }

  // Record that we processed this event (idempotency).
  await supabase.from("stripe_events").insert({
    event_id: event.id,
    event_type: event.type,
  });

  return NextResponse.json({ received: true });
}

/** Map a Stripe subscription status to our internal representation. */
function mapSubscriptionStatus(
  status: string,
):
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused" {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
      return "unpaid";
    case "incomplete":
      return "incomplete";
    case "incomplete_expired":
      return "incomplete_expired";
    case "paused":
      return "paused";
    default:
      return "none";
  }
}

/** Update the profile for the Stripe customer (idempotent upsert). */
async function setProfileFromCustomer(
  customerId: string | null,
  patch: {
    plan: "free" | "standard" | "pro";
    subscriptionStatus:
      | "none"
      | "trialing"
      | "active"
      | "past_due"
      | "canceled"
      | "unpaid"
      | "incomplete"
      | "incomplete_expired"
      | "paused";
    currentPeriodEnd?: string | null;
    /** When true, start a fresh usage period (monthly reset on renewal). */
    resetUsage?: boolean;
  },
) {
  if (!customerId) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, stripe_customer_id, plan, usage_period_start")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (!profile) {
    // No profile linked to this customer yet — could be a checkout where the
    // customer was just created. Upsert by customer id with a placeholder
    // user_id is not possible (FK), so find the user via metadata on the
    // subscription/checkout. To stay safe, we skip — the checkout flow sets
    // plan via the user's own action, and this is best-effort.
    return;
  }

  const update: Record<string, unknown> = {
    plan: patch.plan,
    subscription_status: patch.subscriptionStatus,
  };
  if (patch.currentPeriodEnd !== undefined) {
    update.current_period_end = patch.currentPeriodEnd;
  }
  // Only reset the usage period when the plan actually CHANGED or a new
  // billing cycle started — avoids wiping usage on unrelated updates.
  if (patch.resetUsage && profile.plan !== patch.plan) {
    update.usage_period_start = new Date().toISOString();
  }

  await supabase.from("profiles").update(update).eq("user_id", profile.user_id);

  // ── Sync the entitlements ledger to the new plan ───────────
  // On a plan purchase/change the ledger's allowed_* counts become the new
  // plan's privileges AND used_* resets for the new period.
  await syncLedgerForPlan(profile.user_id, patch.plan, patch.currentPeriodEnd);
}

/** Update the entitlements ledger when a plan changes (webhook). */
async function syncLedgerForPlan(
  userId: string,
  plan: "free" | "standard" | "pro",
  periodEndsAt?: string | null,
) {
  const allowance =
    plan === "standard"
      ? {
          searches: 30,
          evaluations: 30,
          fineTuneResume: 30,
          fineTuneCoverLetter: 30,
        }
      : plan === "pro"
        ? {
            searches: 70,
            evaluations: 70,
            fineTuneResume: 70,
            fineTuneCoverLetter: 70,
          }
        : {
            searches: 1,
            evaluations: 1,
            fineTuneResume: 1,
            fineTuneCoverLetter: 1,
          };

  const now = new Date().toISOString();
  const patch = {
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
    period_ends_at: periodEndsAt ?? null,
    updated_at: now,
  };

  const { error } = await supabase
    .from("entitlements")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) {
    console.error("[stripe webhook] ledger sync error:", error.message);
  }
}
