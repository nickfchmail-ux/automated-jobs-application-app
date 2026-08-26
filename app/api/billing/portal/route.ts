import { getUserId } from "@/lib/auth";
import { getProfile } from "@/lib/entitlements";
import { appUrl, getStripe, isStripeConfigured } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/billing/portal
 *
 * Returns a Stripe Customer Portal session URL so the user can manage their
 * subscription (upgrade/downgrade, cancel, update payment method) without
 * touching our servers. Requires an existing Stripe customer.
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
  if (!profile.stripeCustomerId) {
    return NextResponse.json(
      { error: "No subscription to manage." },
      { status: 404 },
    );
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripeCustomerId,
    return_url: `${appUrl()}/profile`,
  });

  return NextResponse.json({ url: session.url });
}
