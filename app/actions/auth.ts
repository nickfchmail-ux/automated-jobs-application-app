"use server";

import { BACKEND_URL } from "@/lib/fetchWithAuth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AuthState = {
  error?: string;
};

export async function loginAction(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: "Could not reach server. Please try again." };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body?.message ?? "Invalid email or password." };
  }

  const data = await res.json();
  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
  cookieStore.set("token", data.access_token, cookieOpts);
  if (data.refresh_token) {
    cookieStore.set("refresh_token", data.refresh_token, cookieOpts);
  }

  redirect("/");
}

export async function signupAction(
  _prevState: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { error: "Could not reach server. Please try again." };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      error:
        body?.message ?? "Registration failed. Email may already be in use.",
    };
  }

  // Registration succeeded — now log in to obtain tokens
  let loginRes: Response;
  try {
    loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return {
      error: "Account created but could not log in. Please sign in manually.",
    };
  }

  if (!loginRes.ok) {
    redirect("/login");
  }

  const data = await loginRes.json();
  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
  cookieStore.set("token", data.access_token, cookieOpts);
  if (data.refresh_token) {
    cookieStore.set("refresh_token", data.refresh_token, cookieOpts);
  }

  // ── Bootstrap the new account's entitlements (profile + ledger) ──
  // Creates the profile row (if absent) and the entitlements ledger with the
  // Free plan's privileges (1 each) so the user's allowed/used counts exist
  // from the moment the account is created. Idempotent — a returning user
  // already has these rows.
  await bootstrapNewAccount(email, data.access_token).catch(() => {});

  redirect("/");
}

/** Create the profiles row + entitlements ledger for a newly-registered user. */
async function bootstrapNewAccount(email: string, token: string) {
  const { supabase } = await import("@/lib/supabase");
  const { decodeJwt } = await import("jose");
  let userId: string | null = null;
  try {
    userId = (decodeJwt(token).sub as string) ?? null;
  } catch {
    return;
  }
  if (!userId) return;

  const now = new Date().toISOString();
  // Profile (source of truth for plan/role).
  const { data: existing } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) {
    await supabase
      .from("profiles")
      .insert({
        user_id: userId,
        email,
        role: "user",
        plan: "free",
        subscription_status: "none",
        usage_period_start: now,
      })
      .then(() => {});
  }
  // Entitlements ledger (allowed vs used — free plan = 1 each).
  const { data: ledger } = await supabase
    .from("entitlements")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!ledger) {
    await supabase
      .from("entitlements")
      .insert({
        user_id: userId,
        plan: "free",
        allowed_searches: 1,
        allowed_evaluations: 1,
        allowed_fine_tune_resume: 1,
        allowed_fine_tune_cover: 1,
        used_searches: 0,
        used_evaluations: 0,
        used_fine_tune_resume: 0,
        used_fine_tune_cover: 0,
        period_started_at: now,
      })
      .then(() => {});
  }
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("token");
  cookieStore.delete("refresh_token");
}
