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
  cookieStore.set("token", data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

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

  redirect("/login?registered=1");
}

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("token");
  redirect("/login");
}
