import { cookies } from "next/headers";

export const BACKEND_URL = process.env.NEXT_PUBLIC_API_SERVER || "";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

/**
 * Authenticated fetch against the backend.
 * On a 401, attempts a token refresh and retries once.
 * If the refresh also fails, clears auth cookies so the middleware
 * redirects the user to /login on the next navigation.
 */
export async function fetchWithAuth(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (err) {
    console.error(`[fetchWithAuth] Network error fetching ${path}:`, err);
    throw err;
  }

  if (res.status !== 401) {
    if (res.status >= 500) {
      console.error(`[fetchWithAuth] Backend ${res.status} on ${path}`);
    }
    return res;
  }

  // --- Token expired: attempt a refresh ---
  const refreshToken = cookieStore.get("refresh_token")?.value;
  if (!refreshToken) return res; // no refresh token available

  let refreshRes: Response;
  try {
    refreshRes = await fetch(`${BACKEND_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (err) {
    // Network error / timeout → TRANSIENT (Supabase incident, backend down).
    // The token may still be valid — do NOT clear cookies / force logout.
    console.error("[fetchWithAuth] refresh network error (not logging out):", err);
    return res;
  }

  if (refreshRes.status === 401) {
    // Genuinely invalid/expired refresh token → the session is truly gone.
    // Clear cookies so the middleware redirects to /login on next nav.
    cookieStore.delete("token");
    cookieStore.delete("refresh_token");
    return res; // return the original 401
  }

  if (!refreshRes.ok) {
    // 5xx / other transient failure (backend or Supabase incident) — the
    // session may still be valid. Keep cookies; surface the original error.
    console.error(
      `[fetchWithAuth] refresh ${refreshRes.status} (transient, keeping session)`,
    );
    return res;
  }

  const { access_token, refresh_token } = await refreshRes.json();

  cookieStore.set("token", access_token, COOKIE_OPTS);
  if (refresh_token) {
    cookieStore.set("refresh_token", refresh_token, COOKIE_OPTS);
  }

  // Retry the original request with the new access token
  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${access_token}`,
    },
  });
}
