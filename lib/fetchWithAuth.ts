import { cookies } from "next/headers";

export const BACKEND_URL = process.env.BACKEND_URL || "";

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
      console.error(
        `[fetchWithAuth] Backend ${res.status} on ${path}`,
      );
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
    // Refresh token is invalid or expired — force re-login
    cookieStore.delete("token");
    cookieStore.delete("refresh_token");
    return res; // return the original 401
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
