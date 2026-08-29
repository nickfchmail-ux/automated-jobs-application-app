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

    const batches = (data ?? []).map((row) => {
      // fit/not-fit come from the batch's OWN atomic counters (bumped by
      // each worker as it scores a job) — NO jobs-table scan. Deriving them
      // by scanning jobs was fragile: it hit Supabase's 1,000-row REST limit
      // (a user with 1,043 non-duplicate jobs silently lost 43 from every
      // count), mis-handled keyword normalization, and over-counted when a
      // key was matched more than once. The counters are authoritative.
      const total = Number(row.total_jobs ?? 0);
      const processed = Number(row.processed_jobs ?? 0);
      const failed = Number(row.failed_jobs ?? 0);
      const fit = Number(row.fit_jobs ?? 0);
      const notFit = Number(row.not_fit_jobs ?? 0);

      // `remaining` from the batch's OWN atomically-updated counters — NOT a
      // job scan. Workers bump processed/failed as each job finishes, so
      // total - processed - failed is what's still in flight. A job-scan
      // "unscored" count would count FAILED jobs as "remaining" forever (they
      // never get scored), keeping `remaining_jobs` > 0 and the frontend's
      // done-guard never true.
      const remaining = Math.max(0, total - processed - failed);

      return {
        id: row.id,
        keyword: row.keyword,
        status: row.status,
        totalJobs: total,
        processedJobs: processed,
        failedJobs: failed,
        fitJobs: fit,
        notFitJobs: notFit,
        remainingJobs: remaining,
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

    return json(
      {
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
      },
      200,
    );
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
