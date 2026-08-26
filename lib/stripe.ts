import Stripe from "stripe";

/**
 * Stripe server client (singleton).
 *
 * Uses a RESTRICTED API KEY (`rk_…`) scoped to the minimum permissions the
 * server needs: checkout sessions, customer portal, customers, subscriptions,
 * and webhook construction. Never expose this key to the client.
 */
const key = process.env.STRIPE_SECRET_KEY ?? "";

// Lazy singleton so tests / dev reloads don't create multiple clients.
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(key, {
      // Keep in sync with the installed SDK's pinned API version.
      apiVersion: (Stripe as unknown as { API_VERSION?: string }).API_VERSION as Stripe.StripeConfig["apiVersion"],
      typescript: true,
    });
  }
  return _stripe;
}

/** The Pro plan's Price ID (monthly subscription). */
export const PRO_PRICE_ID =
  process.env.STRIPE_PRO_PRICE_ID ?? "";

/** The base URL for redirects (Checkout success/cancel + portal return). */
export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://jobseek.app")
  );
}

/** Whether Stripe is configured (env present). */
export function isStripeConfigured(): boolean {
  return Boolean(key && PRO_PRICE_ID);
}
