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
 *
 * The malformed key is NOT validated with a module-load `throw`: that turns a
 * config mistake into a build-breaking crash and a site-wide outage. Instead
 * we surface a clear error at the call site (see `requireServiceClient`)
 * whenever server code actually tries to use Supabase, so a broken key fails
 * only the requests that need it and never blocks a deploy.
 */
export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Returns the service-role client AFTER validating the key at call time.
 * Returns the exact same type as the exported `supabase` singleton, so every
 * call site gets identical typing to what it had before.
 */
export function requireServiceClient(): typeof supabase {
  if (!supabaseKey) {
    throw new Error(
      "[lib/supabase.ts] SUPABASE_SERVICE_KEY is not set. Add the Supabase " +
        "service_role key (eyJ...) as an environment variable in your " +
        "deployment (Vercel Project → Settings → Environment Variables).",
    );
  }
  if (!supabaseKey.startsWith("eyJ")) {
    throw new Error(
      "[lib/supabase.ts] SUPABASE_SERVICE_KEY is not a JWT. It must be the " +
        "service_role key (eyJ...) from Supabase Dashboard → Project Settings → API. " +
        `Got a ${supabaseKey.startsWith("sb_secret_") ? "`sb_secret_...` Secret-Manager reference" : "non-JWT value"} — ` +
        "this causes 'JWT issued at future' errors on every server query.",
    );
  }
  return supabase;
}
