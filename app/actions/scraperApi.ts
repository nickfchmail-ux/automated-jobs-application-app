"use server";

import { requireServiceClient } from "@/lib/supabase";

/**
 * Check whether ANY ScraperAPI key is available today.
 *
 * ScraperAPI is used ONLY for the Indeed board. Keys live in Supabase
 * `scraper_api_keys`; the backend rotates through them and marks each one
 * `exhausted_on = today` when it runs out of monthly credits. If ALL keys
 * are exhausted today, the frontend should NOT render the Indeed button
 * (there's no point letting the user pick a board that can't run).
 *
 * Returns:
 *   { available: true }  → at least one key is usable today
 *   { available: false } → every key is exhausted today → hide Indeed
 */
export async function getScraperApiAvailability(): Promise<{
  available: boolean;
  exhausted: boolean;
}> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const supabase = requireServiceClient();
    const { data, error } = await supabase
      .from("scraper_api_keys")
      .select("key_value, exhausted_on")
      .limit(100);
    if (error) {
      console.error("[scraperApi availability] query error:", error.message);
      // Fail open: if we can't read the table, don't hide Indeed (the
      // backend will still enforce rotation).
      return { available: true, exhausted: false };
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      // No keys registered — nothing to offer; hide Indeed.
      return { available: false, exhausted: true };
    }
    const anyHealthy = rows.some((r) => r.exhausted_on !== today);
    return { available: anyHealthy, exhausted: !anyHealthy };
  } catch (e) {
    console.error("[scraperApi availability] error:", e);
    return { available: true, exhausted: false };
  }
}
