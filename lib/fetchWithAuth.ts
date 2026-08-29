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

  const refreshRes = await fetch(`${BACKEND_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!refreshRes.ok) {
    // Only a DEFINITIVE 401 (genuinely invalid/expired refresh token) means
    // the session is dead — clear cookies and force re-login. A 503 / 5xx /
    // network blip means the refresh failed TRANSIENTLY (Supabase degraded);
    // the token may still be valid, so keep the session and return the
    // original 401. Clearing cookies here on any non-ok was the auto-logout
    // bug: a Supabase incident made every refresh return 401→503 and the
    // client wiped the session.
    if (refreshRes.status === 401) {
      cookieStore.delete("token");
      cookieStore.delete("refresh_token");
    }
    return res; // return the original 401/response
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
