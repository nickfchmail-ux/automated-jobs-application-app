/**
 * IP-based currency + price resolution for JobSeek plans.
 *
 * BASE prices are fixed in HKD:
 *   - standard: 150 HKD/month (30 search/eval/fine-tune, 1-page, no Indeed,
 *                 up to 10 results per board)
 *   - pro:      300 HKD/month (70 search/eval/fine-tune, multi-page, Indeed,
 *                 unlimited results per board)
 *   - admin:      8 HKD/month (unlimited)
 *
 * On checkout we resolve country from the request IP, map it to a local
 * currency, and convert the HKD base into that currency using a fixed
 * exchange-rate table. The matching Stripe Price ID is looked up from env.
 *
 * SECURITY: this module is SERVER-ONLY. The client never supplies the
 * currency or price — it's derived from the request's IP and the caller's
 * verified role/plan. A user cannot pick a cheaper currency or plan.
 */

export type CurrencyCode =
  | "hkd"
  | "usd"
  | "eur"
  | "gbp"
  | "jpy"
  | "sgd"
  | "aud"
  | "cad"
  | "cny"
  | "twd"
  | "krw"
  | "myr"
  | "thb"
  | "inr"
  | "php";

/** Which subscription plan the user is buying. */
export type PlanTier = "standard" | "pro" | "admin";

/** Base monthly price in HKD per tier. */
export const BASE_PRICE_HKD: Record<PlanTier, number> = {
  standard: 150,
  pro: 300,
  admin: 8,
};

/**
 * HKD → local currency monthly amount per tier, fixed at publish time.
 * (2-decimal currencies; JPY/KRW handled as 0-decimal in the Stripe prices.)
 */
export const MONTHLY_PRICE_BY_CURRENCY: Record<
  CurrencyCode,
  { standard: number; pro: number; admin: number }
> = {
  hkd: { standard: 150, pro: 300, admin: 8 },
  usd: { standard: 19, pro: 38, admin: 1 },
  eur: { standard: 18, pro: 36, admin: 1 },
  gbp: { standard: 15, pro: 30, admin: 1 },
  jpy: { standard: 2900, pro: 5700, admin: 160 },
  sgd: { standard: 26, pro: 52, admin: 1 },
  aud: { standard: 30, pro: 60, admin: 2 },
  cad: { standard: 26, pro: 52, admin: 1 },
  cny: { standard: 138, pro: 276, admin: 7 },
  twd: { standard: 609, pro: 1218, admin: 32 },
  krw: { standard: 25500, pro: 51000, admin: 1360 },
  myr: { standard: 90, pro: 180, admin: 5 },
  thb: { standard: 700, pro: 1400, admin: 37 },
  inr: { standard: 1695, pro: 3390, admin: 90 },
  php: { standard: 1080, pro: 2160, admin: 58 },
};

/** Map a country ISO-2 code → currency. */
const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  HK: "hkd",
  US: "usd",
  GB: "gbp",
  FR: "eur",
  DE: "eur",
  IT: "eur",
  ES: "eur",
  NL: "eur",
  BE: "eur",
  PT: "eur",
  IE: "eur",
  AT: "eur",
  FI: "eur",
  JP: "jpy",
  SG: "sgd",
  AU: "aud",
  CA: "cad",
  CN: "cny",
  TW: "twd",
  KR: "krw",
  MY: "myr",
  TH: "thb",
  IN: "inr",
  PH: "php",
};

/** The env var name pattern for a currency's Stripe Price IDs. */
export function priceEnvKey(currency: CurrencyCode, tier: PlanTier): string {
  return `STRIPE_PRICE_${currency.toUpperCase()}_${tier.toUpperCase()}`;
}

/** The Stripe Price ID for a currency+tier (from env). */
export function getPriceId(
  currency: CurrencyCode,
  tier: PlanTier,
): string | null {
  return process.env[priceEnvKey(currency, tier)] ?? null;
}

/**
 * Resolve the user's currency from the request IP (ipapi.co). Falls back to
 * HKD (the base) on failure — safe, since HKD is the canonical price.
 */
export async function resolveCurrencyFromIp(
  ip: string | null,
): Promise<CurrencyCode> {
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    return "hkd";
  }
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "hkd";
    const data = (await res.json()) as { country_code?: string };
    const cc = (data.country_code ?? "").toUpperCase();
    return COUNTRY_CURRENCY[cc] ?? "hkd";
  } catch {
    return "hkd";
  }
}

/**
 * Resolve the final price for a checkout: currency from IP, amount from the
 * HKD base for the requested tier, and the Stripe Price ID (falling back to
 * the HKD base price when the localized price isn't configured).
 */
export async function resolvePriceForCheckout(opts: {
  ip: string | null;
  tier: PlanTier;
  hkdStandardPriceId: string;
  hkdProPriceId: string;
  hkdAdminPriceId: string;
}): Promise<{
  currency: CurrencyCode;
  amount: number;
  priceId: string;
  tier: PlanTier;
}> {
  const currency = await resolveCurrencyFromIp(opts.ip);
  const localized = getPriceId(currency, opts.tier);

  if (localized) {
    return {
      currency,
      amount: MONTHLY_PRICE_BY_CURRENCY[currency][opts.tier],
      priceId: localized,
      tier: opts.tier,
    };
  }

  // Fallback to the HKD base price for the requested tier.
  const hkdFallback =
    opts.tier === "admin"
      ? opts.hkdAdminPriceId
      : opts.tier === "pro"
        ? opts.hkdProPriceId
        : opts.hkdStandardPriceId;
  return {
    currency: "hkd",
    amount: BASE_PRICE_HKD[opts.tier],
    priceId: hkdFallback,
    tier: opts.tier,
  };
}
