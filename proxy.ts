import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup"];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

async function isTokenValid(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWKS);
    return true;
  } catch (e) {
    console.error("[proxy] JWT verify failed:", (e as Error).message);
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const authenticated = token ? await isTokenValid(token) : false;

  // Not authenticated → redirect to /login (and clear stale cookie if one exists)
  if (!authenticated && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    const response = NextResponse.redirect(loginUrl);
    if (token) response.cookies.delete("token");
    return response;
  }

  // Already authenticated → redirect away from auth pages
  if (authenticated && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
