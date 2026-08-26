import { getUserId } from "@/lib/auth";
import { getProfile } from "@/lib/entitlements";
import { appUrl, getStripe, isStripeConfigured, PRO_PRICE_ID } from "@/lib/stripe";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for the Pro monthly subscription and
 * returns its URL. The user is redirected there; on success Stripe calls the
 * webhook (which sets `plan = pro`), then the user lands on /profile.
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

  const profile = await getProfile(userId);
  const stripe = getStripe();

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
    line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
    subscription_data: {
      metadata: { user_id: userId },
    },
    success_url: `${appUrl()}/profile?upgraded=1`,
    cancel_url: `${appUrl()}/profile?upgrade=cancelled`,
    metadata: { user_id: userId },
  });

  return NextResponse.json({ url: session.url });
}
