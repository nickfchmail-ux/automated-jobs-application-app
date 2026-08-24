import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Supabase client using the **service-role key** (server-side only).
 * RLS is bypassed intentionally: the evaluator is trusted backend code and
 * writes back `fit` / `fit_score` / `fit_reasons` / `cover_letter` on behalf
 * of the scraping pipeline. Never expose this client to the browser.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  // Reuses the same setting names as the existing scrape Function App.
  const url = process.env["SUPABASE_URL"] || process.env["SupabaseUrl"];
  const key =
    process.env["SUPABASE_SERVICE_KEY"] || process.env["SupabaseServiceKey"];
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY must be set");
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
