import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client used ONLY for Realtime subscriptions
 * (postgres_changes) and storage downloads on the client.
 *
 * RLS filters automatically once the user's access token is set as the
 * session — see setSupabaseSession().
 *
 * `autoRefreshToken:false` is CRITICAL: the app's auth is the httpOnly
 * `token` cookie (verified by the Next.js proxy), NOT supabase-js's own
 * session. Without this, supabase-js tries to refresh the (empty-refresh)
 * session every ~60s → `setSession({refresh_token:""})` → 400 → the
 * recurring "An unexpected response was received from the server"
 * unhandledRejection. Realtime only needs the access token for RLS; the
 * JWT is re-issued on every navigation by the proxy.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/**
 * Set the user's access token as the Realtime session so postgres_changes
 * rows are scoped to them (RLS). We pass the SAME token as refresh_token so
 * supabase-js never triggers a refresh (autoRefreshToken is off anyway) —
 * an empty refresh_token was what made the client attempt a refresh.
 */
export function setSupabaseSession(accessToken: string) {
  const sb = getSupabaseBrowser();
  sb.auth.setSession({
    access_token: accessToken,
    refresh_token: accessToken,
  });
}

export function clearSupabaseSession() {
  const sb = getSupabaseBrowser();
  sb.auth.signOut();
}
