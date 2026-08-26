"use server";

import { consumeEntitlement } from "@/lib/entitlements";
import { getToken, getUserId } from "@/lib/auth";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { supabase } from "@/lib/supabase";
import type {
  FunnelCounts,
  PipelineRun,
  RunSummary,
  ScrapeTriggerResponse,
  StatsRunDetailResponse,
  StatsRunsResponse,
  StatsSummaryResponse,
} from "@/types/api";

/* ------------------------------------------------------------------ */
/*  Scrape trigger (Azure Function) + live stats (Express REST).      */
/*                                                                     */
/*  Server-only: the Azure Function key must NEVER reach the client.   */
/* ------------------------------------------------------------------ */

const SCRAPE_FUNCTION_URL =
  (process.env.NEXT_PUBLIC_AZURE_FN_URL ||
    "https://jobsautomation-fn.azurewebsites.net") + "/api/scrape";
const SCRAPE_FUNCTION_KEY = process.env.AZURE_SCRAPE_KEY || "";
const RUN_STATUS_FUNCTION_KEY = process.env.AZURE_RUN_STATUS_KEY || "";

// ── Start scrape ─────────────────────────────────────────────────

export type StartScrapeResult =
  | { ok: true; runId: string; pollUrl: string }
  | { ok: false; error: string };

export interface StartScrapeParams {
  keyword: string;
  pages?: number;
  boards?: string[];
}

export async function startScrapeAction(
  params: StartScrapeParams,
): Promise<StartScrapeResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  // ── Entitlement gate ────────────────────────────────────────
  // Free users get ONE search per keyword (lifetime). Pro/admin are unlimited.
  const entitlement = await consumeEntitlement("search", {
    searchKey: params.keyword,
  });
  if (!entitlement.ok) {
    if (entitlement.reason === "limit_reached") {
      return { ok: false, error: `LIMIT_REACHED: ${entitlement.message}` };
    }
    return { ok: false, error: entitlement.message };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(SCRAPE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-functions-key": SCRAPE_FUNCTION_KEY,
      },
      body: JSON.stringify({
        keyword: params.keyword,
        pages: params.pages ?? 1,
        boards: params.boards,
        user_id: userId,
        country_code: "hk",
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      let errorMsg = `Server error ${res.status}`;
      if (contentType.includes("application/json")) {
        const body = await res.json().catch(() => ({}));
        if (body?.message || body?.error) errorMsg = body.message || body.error;
      }
      console.error(
        `[startScrapeAction] Azure Function returned ${res.status}: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }

    const data = (await res.json()) as ScrapeTriggerResponse;
    return { ok: true, runId: data.runId, pollUrl: data.pollUrl ?? "" };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        error:
          "The job search took too long to start. Please try again in a moment.",
      };
    }
    console.error("[startScrapeAction] Network error:", e);
    return {
      ok: false,
      error: "Could not start your search. Please try again in a moment.",
    };
  }
}

// ── Live stats (Express REST) ────────────────────────────────────

export type StatsSummaryResult =
  | { ok: true; counts: FunnelCounts }
  | { ok: false; error: string };

export async function statsSummaryAction(): Promise<StatsSummaryResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetchWithAuth("/stats/summary", { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `Server error ${res.status}` };
    }
    const data = (await res.json()) as StatsSummaryResponse;
    return { ok: true, counts: data.counts };
  } catch (e) {
    console.error("[statsSummaryAction] Network error:", e);
    return { ok: false, error: "Could not reach the stats server." };
  }
}

export type StatsRunsResult =
  | { ok: true; runs: RunSummary[] }
  | { ok: false; error: string };

export async function statsRunsAction(): Promise<StatsRunsResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetchWithAuth("/stats/runs", { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, error: `Server error ${res.status}` };
    }
    const data = (await res.json()) as StatsRunsResponse;
    return { ok: true, runs: data.runs ?? [] };
  } catch (e) {
    console.error("[statsRunsAction] Network error:", e);
    return { ok: false, error: "Could not reach the stats server." };
  }
}

// ── Per-run detail (Express REST) ────────────────────────────────

export type StatsRunDetailResult =
  | { ok: true; detail: StatsRunDetailResponse }
  | { ok: false; error: string };

/** `GET /stats/runs/:runId` — one run's funnel + per-board breakdown. */
export async function statsRunDetailAction(
  runId: string,
): Promise<StatsRunDetailResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "Not authenticated." };

  try {
    const res = await fetchWithAuth(
      `/stats/runs/${encodeURIComponent(runId)}`,
      {
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return { ok: false, error: `Server error ${res.status}` };
    }
    const data = (await res.json()) as StatsRunDetailResponse;
    return { ok: true, detail: data };
  } catch (e) {
    console.error("[statsRunDetailAction] Network error:", e);
    return { ok: false, error: "Could not reach the stats server." };
  }
}

// ── Azure run-status fallback (Azure Function) ───────────────────

export type AzureRunStatus = {
  run: {
    id: string;
    status: PipelineRun["status"];
    keyword: string;
    total_jobs: number;
    processed_jobs: number;
    fit_jobs: number;
    failed_jobs: number;
    last_error: string | null;
  };
  jobsCount: number;
  statusLabel: string;
};

export type GetAzureRunStatusResult =
  | { ok: true; data: AzureRunStatus }
  | { ok: false; error: string };

/**
 * `GET /api/runs/{runId}` on the Azure Functions host. This is the documented
 * REST fallback for run status + job count (returns a human `statusLabel`).
 * The key lives server-side only.
 */
export async function getAzureRunStatusAction(
  runId: string,
): Promise<GetAzureRunStatusResult> {
  const base =
    process.env.NEXT_PUBLIC_AZURE_FN_URL ||
    "https://jobsautomation-fn.azurewebsites.net";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${base}/api/runs/${encodeURIComponent(runId)}`, {
      headers: { "x-functions-key": RUN_STATUS_FUNCTION_KEY },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      let errorMsg = `Server error ${res.status}`;
      if (contentType.includes("application/json")) {
        const body = await res.json().catch(() => ({}));
        if (body?.error) errorMsg = body.error;
      }
      return { ok: false, error: errorMsg };
    }
    const data = (await res.json()) as AzureRunStatus;
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timeout);
    console.error("[getAzureRunStatusAction] Network error:", e);
    return { ok: false, error: "Could not reach the run-status service." };
  }
}

// ── Resolve run status from pipeline_runs ─────────────────────────

export type GetPipelineRunResult =
  | { ok: true; pipelineRun: PipelineRun | null }
  | { ok: false; error: string };

/**
 * `POST /api/scrape` creates a `pipeline_runs` row and returns its `id` as
 * `runId`. This fetches that row (scoped to the current user) so we can seed
 * the live run status before the first Realtime/WebSocket event arrives.
 */
export async function getPipelineRunAction(
  runId: string,
): Promise<GetPipelineRunResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  try {
    const { data, error } = await supabase
      .from("pipeline_runs")
      .select("*")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error(
        "[getPipelineRunAction] Supabase query error:",
        error.message,
      );
      return { ok: false, error: error.message };
    }

    return { ok: true, pipelineRun: (data as PipelineRun) ?? null };
  } catch (e) {
    console.error("[getPipelineRunAction] Unexpected error:", e);
    return { ok: false, error: "Could not look up the pipeline run." };
  }
}
