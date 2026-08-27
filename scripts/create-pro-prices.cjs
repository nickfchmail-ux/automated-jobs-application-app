/* Create LIVE Pro-tier Stripe prices (300 HKD equivalent) for all currencies.
 * Standard prices already exist; this adds the PRO tier only.
 * Usage: STRIPE_SECRET_KEY=sk_live_... node scripts/create-pro-prices.cjs
 */
const PRODUCT_ID = "prod_V8sHYbIXUQndRv"; // JobSeek Pro (live)

const PRO_PRICES = {
  hkd: { pro: 300, decimals: 2 },
  usd: { pro: 38, decimals: 2 },
  eur: { pro: 36, decimals: 2 },
  gbp: { pro: 30, decimals: 2 },
  jpy: { pro: 5700, decimals: 0 },
  sgd: { pro: 52, decimals: 2 },
  aud: { pro: 60, decimals: 2 },
  cad: { pro: 52, decimals: 2 },
  cny: { pro: 276, decimals: 2 },
  twd: { pro: 1218, decimals: 2 },
  krw: { pro: 51000, decimals: 0 },
  myr: { pro: 180, decimals: 2 },
  thb: { pro: 1400, decimals: 2 },
  inr: { pro: 3390, decimals: 2 },
  php: { pro: 2160, decimals: 2 },
};

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY env required");
  process.exit(1);
}

async function createPrice(currency, amount) {
  const res = await fetch("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      product: PRODUCT_ID,
      currency,
      unit_amount: String(amount),
      "recurring[interval]": "month",
      "metadata[tier]": "pro",
      "metadata[currency]": currency,
      nickname: `JobSeek Pro — ${currency.toUpperCase()} ${amount}/mo`,
    }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error?.message ?? "unknown" };
  return { ok: true, id: data.id };
}

(async () => {
  const results = [];
  for (const [cur, info] of Object.entries(PRO_PRICES)) {
    const major = info.pro;
    const minor = info.decimals === 0 ? major : Math.round(major * 100);
    const r = await createPrice(cur, minor);
    results.push({
      cur,
      id: r.ok ? r.id : null,
      minor,
      ok: r.ok,
      error: r.error,
    });
    console.log(
      `${r.ok ? "✅" : "❌"} ${cur} pro (${minor}) → ${r.ok ? r.id : r.error}`,
    );
  }
  console.log("\n=== ENV VARS ===");
  for (const r of results) {
    if (r.ok) console.log(`STRIPE_PRICE_${r.cur.toUpperCase()}_PRO=${r.id}`);
  }
})();
