import { decodeJwt } from "jose";
import { cookies } from "next/headers";

export async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? null;
}

// Middleware (proxy.ts) already verified the token signature via JWKS.
// Here we just decode the payload to extract the user ID.
export async function getUserId(): Promise<string | null> {
  const token = await getToken();
  if (!token) return null;
  try {
    const payload = decodeJwt(token);
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}
