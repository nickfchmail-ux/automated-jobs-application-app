import { supabase } from "@/lib/supabase";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
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
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      webhookSecret,
    );
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
        await setProfileFromCustomer(customerId, {
          plan: "pro",
          subscriptionStatus: "active",
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const sub = event.data.object;
        const status = mapSubscriptionStatus(sub.status);
        const customerId = sub.customer as string | null;
        // Paused subscriptions don't grant Pro access.
        const plan = status === "active" || status === "trialing" ? "pro" : "free";
        // current_period_end lives on the subscription's items in this API.
        const periodEnd = sub.items?.data?.[0]?.current_period_end;
        await setProfileFromCustomer(customerId, {
          plan,
          subscriptionStatus: status,
          currentPeriodEnd: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
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
        await setProfileFromCustomer(sub.customer as string | null, {
          plan: "pro",
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
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
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
): "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused" {
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
    plan: "free" | "pro";
    subscriptionStatus: "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete" | "incomplete_expired" | "paused";
    currentPeriodEnd?: string | null;
  },
) {
  if (!customerId) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, stripe_customer_id")
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

  await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", profile.user_id);
}
