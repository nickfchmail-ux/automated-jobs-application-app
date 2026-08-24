import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client used ONLY for Realtime subscriptions
 * (postgres_changes) and storage downloads on the client.
 *
 * RLS filters automatically once the user's access token is set as the
 * session — see setSupabaseSession().
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  client = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return client;
}

/** Set the user's session so Realtime rows are scoped to them (RLS). */
export function setSupabaseSession(accessToken: string) {
  const sb = getSupabaseBrowser();
  sb.auth.setSession({
    access_token: accessToken,
    refresh_token: "",
  });
}

export function clearSupabaseSession() {
  const sb = getSupabaseBrowser();
  sb.auth.signOut();
}
