"use server";

import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type {
  EvaluateResponse,
  EvaluateStatusResponse,
  EvaluationRunRow,
} from "@/types/api";

/* ------------------------------------------------------------------ */
/*  AI Evaluator microservice (separate Azure Function app).          */
/*                                                                     */
/*  Server-only: the evaluator function key must NEVER reach the       */
/*  client. This action proxies POST /api/evaluate and GET /api/       */
/*  evaluate/{runId} on the evaluator host, scoped to the current      */
/*  user's runId.                                                      */
/* ------------------------------------------------------------------ */

const EVALUATOR_BASE_URL =
  process.env.NEXT_PUBLIC_EVALUATOR_URL ||
  "https://jobsautomation-evaluator.azurewebsites.net";
const EVALUATOR_FUNCTION_KEY = process.env.AZURE_EVALUATOR_KEY || "";

// ── Trigger evaluation ────────────────────────────────────────────

export type StartEvaluationResult =
  | { ok: true; data: EvaluateResponse }
  | { ok: false; error: string };

/**
 * POST /api/evaluate — group the run's jobs by keyword and enqueue a batch
 * per keyword for the AI evaluator microservice. Only NOT-yet-evaluated jobs
 * are evaluated; optionally restricted to one search key (keyword).
 */
export async function startEvaluationAction(
  runId: string,
  opts?: { searchKey?: string },
): Promise<StartEvaluationResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${EVALUATOR_BASE_URL}/api/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-functions-key": EVALUATOR_FUNCTION_KEY,
      },
      body: JSON.stringify({
        runId,
        user_id: userId,
        search_key: opts?.searchKey ?? undefined,
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
        if (body?.error || body?.message) errorMsg = body.error || body.message;
      }
      console.error(
        `[startEvaluationAction] evaluator returned ${res.status}: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }

    const data = (await res.json()) as EvaluateResponse;
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        error: "Evaluation took too long to start. Please try again.",
      };
    }
    console.error("[startEvaluationAction] Network error:", e);
    return {
      ok: false,
      error: "Could not start evaluation. Please try again in a moment.",
    };
  }
}

// ── Evaluation status (per keyword batch) ─────────────────────────

export type EvaluationStatusResult =
  | { ok: true; data: EvaluateStatusResponse }
  | { ok: false; error: string };

/**
 * GET /api/evaluate/{runId} on the evaluator host — per-keyword batch
 * progress. Used to hydrate the evaluation panel before Realtime events
 * arrive.
 */
export async function getEvaluationStatusAction(
  runId: string,
): Promise<EvaluationStatusResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(
      `${EVALUATOR_BASE_URL}/api/evaluate/${encodeURIComponent(runId)}`,
      {
        headers: { "x-functions-key": EVALUATOR_FUNCTION_KEY },
        signal: controller.signal,
        cache: "no-store",
      },
    );
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
    const data = (await res.json()) as EvaluateStatusResponse;
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timeout);
    console.error("[getEvaluationStatusAction] Network error:", e);
    return { ok: false, error: "Could not reach the evaluator service." };
  }
}

// ── Local Supabase helpers (no evaluator call needed) ─────────────

export type GetEvaluationRunsResult =
  | { ok: true; runs: EvaluationRunRow[] }
  | { ok: false; error: string };

/**
 * Read `evaluation_runs` rows for a run directly from Supabase — a cheap,
 * realtime-friendly alternative to the evaluator REST status endpoint. The
 * frontend subscribes to this table via Realtime for live per-batch progress.
 */
export async function getEvaluationRunsAction(
  runId: string,
): Promise<GetEvaluationRunsResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  try {
    const { data, error } = await supabase
      .from("evaluation_runs")
      .select("*")
      .eq("pipeline_run_id", runId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(
        "[getEvaluationRunsAction] Supabase query error:",
        error.message,
      );
      return { ok: false, error: error.message };
    }
    return { ok: true, runs: (data as EvaluationRunRow[]) ?? [] };
  } catch (e) {
    console.error("[getEvaluationRunsAction] Unexpected error:", e);
    return { ok: false, error: "Could not load evaluation progress." };
  }
}

/** Update a run's `evaluation_status` locally (scoped to the user). */
export type SetEvaluationStatusResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setRunEvaluationStatusAction(
  runId: string,
  status: "queued" | "evaluating" | "completed" | "failed",
): Promise<SetEvaluationStatusResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const { error } = await supabase
    .from("pipeline_runs")
    .update({ evaluation_status: status })
    .eq("id", runId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
