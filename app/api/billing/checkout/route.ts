import { getUserEmail, getUserId } from "@/lib/auth";
import { getProfile } from "@/lib/entitlements";
import { resolvePriceForCheckout, type PlanTier } from "@/lib/pricing";
import {
  ADMIN_PRICE_ID,
  appUrl,
  getStripe,
  isStripeConfigured,
  PRO_PRICE_ID,
  STANDARD_PRICE_ID,
} from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/** Pull the real client IP from the request (behind Vercel/Cloudflare proxies). */
function getClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return (
    req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? null
  );
}

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for a subscription plan and returns its
 * URL. The requested tier comes from the body ("standard" | "pro"); the admin
 * tier is NEVER client-selectable — admins get it automatically.
 *
 * Price is chosen SERVER-SIDE from:
 *   1. the caller's verified role (admin → 8 HKD base)
 *   2. the requested tier (standard → 150 HKD, pro → 300 HKD)
 *   3. the caller's IP → country → local currency
 *
 * The client can NEVER pick the currency, price, or the admin tier.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured." },
      { status: 503 },
    );
  }

  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const email = await getUserEmail();
  const profile = await getProfile(userId, email);
  const stripe = getStripe();

  // Determine the effective tier: admins always buy at the admin price.
  let tier: PlanTier;
  if (profile.role === "admin") {
    tier = "admin";
  } else {
    const body = (await req.json().catch(() => ({}))) as { tier?: string };
    const requested = body.tier === "pro" ? "pro" : "standard";
    tier = requested;
  }

  // Resolve the price from IP + tier (server-side only).
  const price = await resolvePriceForCheckout({
    ip: getClientIp(req),
    tier,
    hkdStandardPriceId: STANDARD_PRICE_ID,
    hkdProPriceId: PRO_PRICE_ID,
    hkdAdminPriceId: ADMIN_PRICE_ID,
  });

  // Reuse the existing Stripe customer if we have one.
  let customerId = profile.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { user_id: userId },
    });
    customerId = customer.id;
    // Persist the link so the webhook can resolve user_id from customer id.
    await supabase
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("user_id", userId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    // Do NOT pass payment_method_types — Stripe picks dynamically.
    line_items: [{ price: price.priceId, quantity: 1 }],
    subscription_data: {
      metadata: {
        user_id: userId,
        plan_tier: tier,
        currency: price.currency,
      },
    },
    success_url: `${appUrl()}/profile?upgraded=1`,
    cancel_url: `${appUrl()}/profile?upgrade=cancelled`,
    metadata: { user_id: userId, plan_tier: tier },
  });

  return NextResponse.json({
    url: session.url,
    currency: price.currency,
    amount: price.amount,
    tier,
  });
}
