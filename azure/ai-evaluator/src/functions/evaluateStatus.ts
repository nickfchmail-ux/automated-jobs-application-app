import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getSupabase } from "../lib/supabase.js";

/**
 * GET /api/evaluate/{runId}
 *
 * Returns per-keyword-batch progress for a run. The frontend uses this to
 * render the "Evaluating…" panel: each keyword shows queued/evaluating/done
 * plus processed/total per batch.
 */
export const evaluateStatus: HttpHandler = async (
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> => {
  const runId = req.params.runId;
  if (!runId) return json({ error: "runId is required" }, 400);

  const sb = getSupabase();
  try {
    const { data, error } = await sb
      .from("evaluation_runs")
      .select("*")
      .eq("pipeline_run_id", runId)
      .order("created_at", { ascending: true });

    if (error) {
      return json({ error: error.message }, 500);
    }

    // Fetch this run's jobs so we can compute fit / not-fit / remaining per
    // batch (mirrors the backend wsPush.ts getEvaluationState).
    const { data: jobs, error: jobsErr } = await sb
      .from("jobs")
      .select("search_key, fit, fit_score")
      .eq("pipeline_run_id", runId);
    if (jobsErr) {
      context.error(`evaluateStatus jobs query failed: ${jobsErr.message}`);
    }

    const fitByKey = new Map<string, number>();
    const notFitByKey = new Map<string, number>();
    const remainingByKey = new Map<string, number>();
    for (const j of (jobs ?? []) as {
      search_key: string | null;
      fit: boolean | null;
      fit_score: number | null;
    }[]) {
      const key = String(j.search_key ?? "general").trim().toLowerCase();
      if (j.fit_score === null) {
        remainingByKey.set(key, (remainingByKey.get(key) ?? 0) + 1);
      } else if (j.fit === true) {
        fitByKey.set(key, (fitByKey.get(key) ?? 0) + 1);
      } else if (j.fit === false) {
        notFitByKey.set(key, (notFitByKey.get(key) ?? 0) + 1);
      }
    }

    const batches = (data ?? []).map((row) => {
      const key = String(row.keyword ?? "general").trim().toLowerCase();
      return {
        id: row.id,
        keyword: row.keyword,
        status: row.status,
        totalJobs: row.total_jobs,
        processedJobs: row.processed_jobs,
        failedJobs: row.failed_jobs,
        fitJobs: fitByKey.get(key) ?? 0,
        notFitJobs: notFitByKey.get(key) ?? 0,
        remainingJobs: remainingByKey.get(key) ?? 0,
        lastError: row.last_error,
        updatedAt: row.updated_at,
      };
    });

    const total = batches.reduce((n, b) => n + b.totalJobs, 0);
    const processed = batches.reduce((n, b) => n + b.processedJobs, 0);
    const failed = batches.reduce((n, b) => n + b.failedJobs, 0);
    const fit = batches.reduce((n, b) => n + b.fitJobs, 0);
    const notFit = batches.reduce((n, b) => n + b.notFitJobs, 0);
    const remaining = batches.reduce((n, b) => n + b.remainingJobs, 0);
    const active = batches.filter(
      (b) => b.status === "evaluating" || b.status === "queued",
    ).length;

    return json({
      ok: true,
      runId,
      total,
      processed,
      failed,
      fit,
      notFit,
      remaining,
      activeBatches: active,
      batches,
    }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`evaluateStatus failed: ${msg}`);
    return json({ error: msg }, 500);
  }
};

function json(body: unknown, status: number): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: new Headers({ "Content-Type": "application/json" }),
  };
}
