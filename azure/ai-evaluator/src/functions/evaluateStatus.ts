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

    const batches = (data ?? []).map((row) => ({
      id: row.id,
      keyword: row.keyword,
      status: row.status,
      totalJobs: row.total_jobs,
      processedJobs: row.processed_jobs,
      failedJobs: row.failed_jobs,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));

    const total = batches.reduce((n, b) => n + b.totalJobs, 0);
    const processed = batches.reduce((n, b) => n + b.processedJobs, 0);
    const failed = batches.reduce((n, b) => n + b.failedJobs, 0);
    const active = batches.filter(
      (b) => b.status === "evaluating" || b.status === "queued",
    ).length;

    return json({
      ok: true,
      runId,
      total,
      processed,
      failed,
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
