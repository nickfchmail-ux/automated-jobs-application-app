import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? "";

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
 * IMPORTANT (build-safety): the client is created LAZILY via a getter, not at
 * module load. `next build` imports route modules during page-data collection,
 * and if env vars aren't available at that instant (e.g. a Vercel deploy
 * where the var is temporarily unresolved), a module-load `createClient(...)`
 * throws "supabaseUrl is required" and fails the ENTIRE build/deploy. By
 * deferring creation until a call site actually invokes the client, a missing
 * env var fails only the request that needs it — never the build.
 */
let _serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  if (!supabaseUrl) {
    throw new Error(
      "[lib/supabase.ts] NEXT_PUBLIC_SUPABASE_URL is not set. Add it as an " +
        "environment variable in your deployment (Vercel Project → Settings → " +
        "Environment Variables).",
    );
  }
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
  _serviceClient = createClient(supabaseUrl, supabaseKey);
  return _serviceClient;
}

/**
 * Returns the service-role client AFTER validating the key at call time.
 * Returns the exact same type as the (now lazy) service client, so every call
 * site gets identical typing to what it had before.
 */
export function requireServiceClient(): SupabaseClient {
  return getServiceClient();
}

// Backwards-compatible export: resolves the lazy client. Never throws at
// module load — only when actually used (mirrors the old `supabase` export
// without the build-breaking eager `createClient`).
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop, receiver) {
    const client = getServiceClient();
    const v = Reflect.get(client, prop, receiver);
    return typeof v === "function" ? v.bind(client) : v;
  },
});
