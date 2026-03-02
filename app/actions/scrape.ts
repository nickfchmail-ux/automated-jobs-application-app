"use server";

import { cookies } from "next/headers";

const BASE_URL =
  "https://automated-jobs-application-app-production.up.railway.app";

async function getToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("token")?.value ?? null;
}

export type StartScrapeResult =
  | { ok: true; jobId: string; pollUrl: string }
  | { ok: false; error: string };

export async function startScrapeAction(
  keyword: string,
  pages: number,
  force: boolean = false,
): Promise<StartScrapeResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetch(`${BASE_URL}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keyword, pages, force }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: body?.message ?? `Server error ${res.status}`,
      };
    }

    const data = await res.json();
    return { ok: true, jobId: data.jobId, pollUrl: data.pollUrl ?? "" };
  } catch (e) {
    return { ok: false, error: "Could not reach scrape server." };
  }
}

export type PollResult =
  | { ok: true; status: string; logs: string[]; result?: unknown }
  | { ok: false; error: string };

export async function pollJobAction(jobId: string): Promise<PollResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetch(`${BASE_URL}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error: body?.message ?? `Server error ${res.status}`,
      };
    }

    const data = await res.json();
    return {
      ok: true,
      status: data.status,
      logs: data.logs ?? [],
      result: data.result,
    };
  } catch {
    return { ok: false, error: "Could not reach scrape server." };
  }
}
