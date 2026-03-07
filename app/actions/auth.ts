"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BASE_URL =
  "https://automated-jobs-application-app-production.up.railway.app";

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
    res = await fetch(`${BASE_URL}/auth/login`, {
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
    res = await fetch(`${BASE_URL}/auth/register`, {
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
    loginRes = await fetch(`${BASE_URL}/auth/login`, {
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

  redirect("/");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("token");
  cookieStore.delete("refresh_token");
  redirect("/login");
}
