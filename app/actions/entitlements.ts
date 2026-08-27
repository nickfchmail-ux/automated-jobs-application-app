"use server";

import { getEntitlements } from "@/lib/entitlements";

/**
 * Server action: return the current user's entitlement summary for UI gating.
 * Client components call this (e.g. on mount) to decide whether to disable
 * the Search / Match / Generate buttons when quota is exhausted.
 *
 * NOTE: this is a UI convenience — the REAL enforcement happens in the
 * backend Azure Functions (`consumeUsage`), which is the single writer of
 * `usage_records`.
 */
export async function getEntitlementGatesAction() {
  const summary = await getEntitlements();
  return summary;
}
