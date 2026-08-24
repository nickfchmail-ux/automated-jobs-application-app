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
    // The batches may be account-wide (evaluating a search key across runs),
    // so we need the run's user_id to query the jobs that batch actually
    // touched, regardless of which run they live in.
    const { data: runRow, error: runErr } = await sb
      .from("pipeline_runs")
      .select("user_id")
      .eq("id", runId)
      .maybeSingle();
    if (runErr) {
      context.error(`evaluateStatus run query failed: ${runErr.message}`);
    }
    const userId = runRow?.user_id;

    const { data, error } = await sb
      .from("evaluation_runs")
      .select("*")
      .eq("pipeline_run_id", runId)
      .order("created_at", { ascending: true });

    if (error) {
      return json({ error: error.message }, 500);
    }

    // Fetch the user's jobs for the batch keyword (account-wide) so fit /
    // not-fit / remaining match the batch's total even when the batch spans
    // multiple runs. A job counts toward a batch if it was touched by that
    // batch: scored at/after the batch's created_at, or still unscored.
    const { data: jobs, error: jobsErr } = userId
      ? await sb
          .from("jobs")
          .select("search_key, fit, fit_score, updated_at")
          .eq("user_id", userId)
          .in("status", ["completed", "analysed"])
      : { data: null, error: null };
    if (jobsErr) {
      context.error(`evaluateStatus jobs query failed: ${jobsErr.message}`);
    }

    const jobsForUser = (jobs ?? []) as {
      search_key: string | null;
      fit: boolean | null;
      fit_score: number | null;
      updated_at: string | null;
    }[];

    const batches = (data ?? []).map((row) => {
      const key = String(row.keyword ?? "general")
        .trim()
        .toLowerCase();
      const batchStart = row.created_at
        ? new Date(row.created_at).getTime()
        : 0;

      let fit = 0;
      let notFit = 0;
      let remaining = 0;
      for (const j of jobsForUser) {
        if (
          String(j.search_key ?? "general")
            .trim()
            .toLowerCase() !== key
        )
          continue;
        // Only jobs touched by THIS batch: scored at/after batch start, or
        // still unscored (they belong to the current in-progress batch).
        const touched =
          j.fit_score === null ||
          (j.updated_at && new Date(j.updated_at).getTime() >= batchStart);
        if (!touched) continue;
        if (j.fit_score === null) remaining++;
        else if (j.fit === true) fit++;
        else if (j.fit === false) notFit++;
      }

      return {
        id: row.id,
        keyword: row.keyword,
        status: row.status,
        totalJobs: row.total_jobs,
        processedJobs: row.processed_jobs,
        failedJobs: row.failed_jobs,
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
