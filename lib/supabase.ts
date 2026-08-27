import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

/**
 * The Supabase service-role key MUST be a JWT (starts with `eyJ` — the base64
 * of `{"alg":...}`). A malformed value (e.g. the Secret-Manager reference
 * format `sb_secret_...`) gets sent as a Bearer token and produces cryptic
 * gateway errors like "JWT issued at future" on every server-side query.
 *
 * The correct value is found at: Supabase Dashboard → Project Settings →
 * API → "service_role" (the long `eyJ...` JWT under "Project API keys").
 * Never use `sb_secret_...` here — that is only valid for `supabase secrets`.
 */
if (supabaseKey && !supabaseKey.startsWith("eyJ")) {
  throw new Error(
    "[lib/supabase.ts] SUPABASE_SERVICE_KEY is not a JWT. It must be the " +
      "service_role key (eyJ...) from Supabase Dashboard → Project Settings → API. " +
      `Got a ${supabaseKey.startsWith("sb_secret_") ? "`sb_secret_...` Secret-Manager reference" : "non-JWT value"} — ` +
      "this causes 'JWT issued at future' errors on every server query.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
