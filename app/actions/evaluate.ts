"use server";

import { getUserId } from "@/lib/auth";
import { consumeEntitlement } from "@/lib/entitlements";
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
// Per-function key for the `evaluate` POST trigger.
const EVALUATOR_FUNCTION_KEY = process.env.AZURE_EVALUATOR_KEY || "";
// HOST key — authorizes EVERY function, including GET /api/evaluate/{runId}
// (the per-function key above only unlocks the POST trigger; using it for
// the status read returns 401, which made the fit/not-fit poller silently
// fall back to a DB read with no fit columns → "0 fit / 0 not fit").
const EVALUATOR_HOST_KEY =
  process.env.AZURE_EVALUATOR_HOST_KEY || EVALUATOR_FUNCTION_KEY;

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

  // ── Entitlement gate ────────────────────────────────────────
  // Free users get ONE evaluation per search key (lifetime). The evaluation
  // consumes quota for the search key being matched.
  const entitlement = await consumeEntitlement("evaluation", {
    searchKey: opts?.searchKey ?? undefined,
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
        headers: { "x-functions-key": EVALUATOR_HOST_KEY },
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

/** One search key in the evaluator's "match" dropdown. */
export interface SearchKeyOption {
  /** Normalized search_key (e.g. "web_developer") — sent to the evaluator. */
  searchKey: string;
  /** Human display keyword (e.g. "web developer") — shown in the dropdown. */
  keyword: string;
  /** Total jobs scraped under this key. */
  total: number;
  /** Jobs under this key that have NOT been evaluated yet. */
  unevaluated: number;
  /**
   * A valid `pipeline_runs.id` that has unevaluated jobs under this key.
   * Lets the UI trigger evaluation even when there's no active run in Redux
   * (e.g. after a page reload) — the evaluator requires a completed run.
   */
  runId: string | null;
}

export type ListSearchKeysResult =
  | { ok: true; keys: SearchKeyOption[]; runId: string | null }
  | { ok: false; error: string };

/**
 * List the search keys that still have unevaluated posts — ACROSS ALL of the
 * user's runs (not just one run). This is the authoritative source for the
 * "Match" dropdown: it reads the `jobs` table (not transient Redux state),
 * groups by `search_key` across every completed run, and only returns keys
 * where `fit_score IS NULL` (i.e. not yet evaluated). The `runId` is passed
 * through so the UI can highlight the current search's key, but the list
 * itself is account-wide.
 */
export async function listSearchKeysAction(
  runId: string | null = null,
): Promise<ListSearchKeysResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  try {
    // Fetch search_key + fit_score + pipeline_run_id for ALL the user's jobs
    // that made it through scraping. We group account-wide so every search
    // key with unevaluated posts shows up, not just the current run's.
    const { data: scored, error: scoredErr } = await supabase
      .from("jobs")
      .select("search_key, fit_score, pipeline_run_id")
      .eq("user_id", userId)
      .in("status", ["completed", "analysed"]);

    if (scoredErr) {
      console.error(
        "[listSearchKeysAction] scored query error:",
        scoredErr.message,
      );
      return { ok: false, error: scoredErr.message };
    }

    const byKey = new Map<
      string,
      { total: number; unevaluated: number; runId: string | null }
    >();
    for (const row of (scored ?? []) as {
      search_key: string | null;
      fit_score: number | null;
      pipeline_run_id: string | null;
    }[]) {
      const key = (row.search_key ?? "").trim().toLowerCase();
      if (!key) continue;
      const entry = byKey.get(key) ?? {
        total: 0,
        unevaluated: 0,
        runId: null,
      };
      entry.total++;
      if (row.fit_score === null) {
        entry.unevaluated++;
        // Remember a run that has unevaluated jobs under this key so we can
        // always trigger evaluation with a valid run context.
        if (!entry.runId && row.pipeline_run_id) {
          entry.runId = row.pipeline_run_id;
        }
      }
      byKey.set(key, entry);
    }

    const keys: SearchKeyOption[] = [...byKey.entries()]
      .map(([searchKey, { total, unevaluated, runId: keyRunId }]) => ({
        searchKey,
        keyword: searchKey.replace(/_/g, " "),
        total,
        unevaluated,
        runId: keyRunId,
      }))
      // Only keys that still have unevaluated posts belong in the dropdown.
      .filter((k) => k.unevaluated > 0)
      .sort((a, b) => b.unevaluated - a.unevaluated || b.total - a.total);

    return { ok: true, keys, runId };
  } catch (e) {
    console.error("[listSearchKeysAction] Unexpected error:", e);
    return { ok: false, error: "Could not load search keys." };
  }
}

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
