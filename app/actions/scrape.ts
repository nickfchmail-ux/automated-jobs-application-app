"use server";

import { getToken } from "@/lib/auth";
import { BACKEND_URL, fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  JobStatus,
  PollProgress,
  PollResultData,
} from "@/types/api";

// ── Start scrape ─────────────────────────────────────────────────

export type StartScrapeResult =
  | { ok: true; jobId: string; pollUrl: string }
  | { ok: false; error: string };

export interface StartScrapeParams {
  keyword: string;
  pages?: number;
  force?: boolean;
  boards?: string[];
}

export async function startScrapeAction(
  params: StartScrapeParams,
): Promise<StartScrapeResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    const res = await fetchWithAuth("/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: params.keyword,
        pages: params.pages ?? 1,
        force: params.force ?? false,
        boards: params.boards,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // Try JSON first, fall back to text (Render may return HTML error pages)
      const contentType = res.headers.get("content-type") ?? "";
      let errorMsg = `Server error ${res.status}`;

      if (contentType.includes("application/json")) {
        const body = await res.json().catch(() => ({}));
        if (body?.message || body?.error) {
          errorMsg = body.message || body.error;
        }
      } else {
        const text = await res.text().catch(() => "");
        console.error(
          `[startScrapeAction] Backend returned ${res.status} (non-JSON):`,
          text.slice(0, 500),
        );
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          errorMsg =
            "The scrape server is currently unavailable. It may be waking up from idle — please try again in 30 seconds.";
        } else if (res.status === 500) {
          errorMsg =
            "The scrape server encountered an internal error. This may be due to an invalid API key or database connection issue on the backend.";
        }
      }

      console.error(
        `[startScrapeAction] Backend ${BACKEND_URL}/scrape returned ${res.status}: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }

    const data = await res.json();
    return { ok: true, jobId: data.jobId, pollUrl: data.pollUrl ?? "" };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        error:
          "Request timed out after 2 minutes. The scrape server may be overloaded or stuck.",
      };
    }
    console.error("[startScrapeAction] Network error:", e);
    return {
      ok: false,
      error:
        "Could not reach the scrape server. It may be down or waking up from idle — please try again in 30 seconds.",
    };
  }
}

// ── Poll job ─────────────────────────────────────────────────────

export type PollResult =
  | {
      ok: true;
      status: JobStatus;
      logs: string[];
      progress?: PollProgress;
      result?: PollResultData;
      error?: string;
    }
  | { ok: false; error: string };

export async function pollJobAction(jobId: string): Promise<PollResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const res = await fetchWithAuth(`/jobs/${jobId}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      let errorMsg = `Server error ${res.status}`;

      if (contentType.includes("application/json")) {
        const body = await res.json().catch(() => ({}));
        if (body?.message || body?.error) {
          errorMsg = body.message || body.error;
        }
      }

      console.error(
        `[pollJobAction] Backend returned ${res.status} for job ${jobId}: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }

    const data = await res.json();
    return {
      ok: true,
      status: data.status,
      logs: data.logs ?? [],
      progress: data.progress,
      result: data.result,
      error: data.error,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: "Poll request timed out." };
    }
    return { ok: false, error: "Could not reach scrape server." };
  }
}
