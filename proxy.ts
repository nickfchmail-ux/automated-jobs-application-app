import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
} from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/api/webhooks"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const BACKEND_URL = process.env.NEXT_PUBLIC_API_SERVER || "";
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 days — matches app/actions/auth.ts
};

type TokenStatus = "valid" | "expired" | "invalid" | "unreachable";

/**
 * Verify the access token signature against Supabase's JWKS.
 *
 * Returns a tri-state so the caller can tell the difference between a token
 * that is genuinely bad (expired / bad signature) and a transient failure to
 * reach Supabase's JWKS endpoint. The latter must NOT log the user out —
 * that's what caused random "auto logout" bounces on navigation.
 */
async function tokenStatus(token: string): Promise<TokenStatus> {
  try {
    await jwtVerify(token, JWKS);
    return "valid";
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) return "expired";
    // Any other JOSE error (bad signature, no matching key, malformed) means
    // the token is genuinely invalid.
    if (e instanceof joseErrors.JOSEError) return "invalid";
    // Non-JOSE error → the JWKS fetch itself failed (DNS / network / Vercel
    // cold start). We can't verify, so treat as "unreachable", not "invalid".
    console.error("[proxy] JWKS fetch failed (not forcing logout):", e);
    return "unreachable";
  }
}

/** Exchange the refresh token for a fresh access token via the backend. */
async function refreshTokens(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string } | null> {
  if (!BACKEND_URL) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
      });
      // A 401 means the refresh token itself is invalid/expired → the session
      // is genuinely gone → return a marker so the caller forces logout.
      // A 500 / network error is a TRANSIENT backend/Supabase failure (e.g.
      // an incident) — the token may still be fine, so we must NOT log the
      // user out. Return a distinct sentinel so the caller can keep them in.
      if (res.status === 401) return { access_token: "__invalid__" };
      if (!res.ok) return "__transient__" as never; // 5xx / other
      const data = await res.json();
      if (!data?.access_token) return "__transient__" as never;
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    console.error("[proxy] token refresh failed:", e);
    // Network error / timeout → transient, not a real logout condition.
    return "__transient__" as never;
  }
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const refreshToken = request.cookies.get("refresh_token")?.value;
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const status = token ? await tokenStatus(token) : "invalid";

  // 1) Token is valid → continue (or redirect off auth pages).
  if (status === "valid") {
    if (isPublic) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // 2) Public pages never need a valid token.
  if (isPublic) {
    return NextResponse.next();
  }

  // 3) We couldn't verify the token because the JWKS fetch itself failed
  //    ("unreachable") — the token may still be valid. Never log the user
  //    out in this case; let the request through and let server code /
  //    fetchWithAuth handle a genuinely bad token.
  if (status === "unreachable") {
    return NextResponse.next();
  }

  // 4) Token is expired/invalid but we have a refresh token — try to refresh
  //    ONCE before bouncing the user to /login. This is what keeps users
  //    signed in past the ~1h Supabase access-token lifetime.
  if (refreshToken) {
    const fresh = await refreshTokens(refreshToken);
    // Genuinely invalid refresh token → the session is truly gone → logout.
    if (fresh?.access_token === "__invalid__") {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      const response = NextResponse.redirect(loginUrl);
      if (token) response.cookies.delete("token");
      if (refreshToken) response.cookies.delete("refresh_token");
      return response;
    }
    // Successful refresh → set fresh cookies and continue.
    if (fresh?.access_token) {
      const response = NextResponse.next();
      response.cookies.set("token", fresh.access_token, COOKIE_OPTS);
      if (fresh.refresh_token) {
        response.cookies.set("refresh_token", fresh.refresh_token, COOKIE_OPTS);
      }
      return response;
    }
    // "__transient__" (backend 5xx / network / timeout) — the token may still
    // be valid; do NOT log the user out. Let the request through; the server
    // actions will surface any genuine auth error via fetchWithAuth.
    return NextResponse.next();
  }

  // 5) Genuinely expired/invalid and refresh failed (or no refresh token) →
  //    send to /login and clear the stale cookies.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  const response = NextResponse.redirect(loginUrl);
  if (token) response.cookies.delete("token");
  if (refreshToken) response.cookies.delete("refresh_token");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
