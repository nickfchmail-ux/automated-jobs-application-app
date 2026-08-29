import type { EvaluationRunRow, EvaluationRunStatus } from "../shared/types.js";
import { getSupabase } from "./supabase.js";

/**
 * Read/write helpers for the `evaluation_runs` status table.
 * One row per keyword batch so the frontend can show per-keyword progress.
 */

export async function getEvaluationRun(
  evaluationRunId: string,
): Promise<EvaluationRunRow | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("evaluation_runs")
    .select("*")
    .eq("id", evaluationRunId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load evaluation run: ${error.message}`);
  }
  return (data as EvaluationRunRow) ?? null;
}

export async function updateEvaluationRunStatus(
  evaluationRunId: string,
  status: EvaluationRunStatus,
  patch: Partial<{
    processed_jobs: number;
    failed_jobs: number;
    last_error: string | null;
    started_at: string | null;
    completed_at: string | null;
  }> = {},
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("evaluation_runs")
    .update({ status, updated_at: new Date().toISOString(), ...patch })
    .eq("id", evaluationRunId);
  if (error) {
    throw new Error(`Failed to update evaluation run: ${error.message}`);
  }
}

/**
 * ATOMICALLY increment an evaluation batch's processed/failed/fit/not-fit
 * counts and report whether the batch is now complete. Used by the per-job
 * fan-out workers — a naive read-modify-write here would race and lose
 * updates.
 *
 * The worker passes the OUTCOME of the job it just scored (fit / not-fit),
 * so the batch's fit_jobs / not_fit_jobs counters are the authoritative
 * per-batch result. The frontend reads these directly — NO jobs-table scan
 * (which hit the 1,000-row REST limit and miscounted across re-matches).
 *
 * Returns `done = true` when every job in the batch has reached a terminal
 * outcome (processed + failed >= total), so the LAST worker can finalize.
 */
export async function incrementEvaluationRun(params: {
  evaluationRunId: string;
  processed: number;
  failed: number;
  fit?: number;
  notFit?: number;
  lastError?: string | null;
}): Promise<{
  total: number;
  processed: number;
  failed: number;
  fit: number;
  notFit: number;
  done: boolean;
}> {
  const sb = getSupabase();

  // Preferred: atomic RPC (migration 004 + 005) so concurrent workers never
  // lose an update.
  try {
    const { data, error } = await sb.rpc("increment_evaluation_run", {
      p_run_id: params.evaluationRunId,
      p_processed: params.processed,
      p_failed: params.failed,
      p_last_error: params.lastError ?? null,
      p_fit: params.fit ?? 0,
      p_not_fit: params.notFit ?? 0,
    });
    if (!error) {
      const r = (data ?? {}) as {
        total?: number;
        processed?: number;
        failed?: number;
        fit?: number;
        notFit?: number;
        done?: boolean;
      };
      return {
        total: Number(r.total ?? 0),
        processed: Number(r.processed ?? 0),
        failed: Number(r.failed ?? 0),
        fit: Number(r.fit ?? 0),
        notFit: Number(r.notFit ?? 0),
        done: Boolean(r.done),
      };
    }
    // Fall through to the non-atomic fallback if the RPC is missing.
    console.warn(
      `[incrementEvaluationRun] RPC missing/error (${error.message}); using fallback`,
    );
  } catch (e) {
    console.warn(
      `[incrementEvaluationRun] RPC failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Fallback: read-modify-write (non-atomic — acceptable at low concurrency;
  // install migration 004/005 for full atomicity at high concurrency).
  const { data: row, error: readErr } = await sb
    .from("evaluation_runs")
    .select("total_jobs, processed_jobs, failed_jobs, fit_jobs, not_fit_jobs")
    .eq("id", params.evaluationRunId)
    .maybeSingle();
  if (readErr) {
    throw new Error(`Failed to read evaluation run: ${readErr.message}`);
  }
  const total = Number(row?.total_jobs ?? 0);
  const processed = Number(row?.processed_jobs ?? 0) + params.processed;
  const failed = Number(row?.failed_jobs ?? 0) + params.failed;
  const fit = Number(row?.fit_jobs ?? 0) + (params.fit ?? 0);
  const notFit = Number(row?.not_fit_jobs ?? 0) + (params.notFit ?? 0);

  const { error: updErr } = await sb
    .from("evaluation_runs")
    .update({
      processed_jobs: processed,
      failed_jobs: failed,
      fit_jobs: fit,
      not_fit_jobs: notFit,
      last_error: params.lastError ?? null,
      status: "evaluating",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.evaluationRunId);
  if (updErr) {
    throw new Error(`Failed to update evaluation run: ${updErr.message}`);
  }

  return {
    total,
    processed,
    failed,
    fit,
    notFit,
    done: processed + failed >= total,
  };
}

/**
 * Set the OVERALL evaluation state on `pipeline_runs.evaluation_status`.
 *
 * The frontend's whole "Match jobs" flow keys off this column via Realtime
 * (none → evaluating → completed / failed). The old queue-based design never
 * set it, so the dashboard stayed stuck on "Matching jobs…" forever even
 * after every batch finished. The orchestrator calls this once at the end.
 */
export async function setPipelineRunEvaluationStatus(
  pipelineRunId: string,
  userId: string,
  status: "queued" | "evaluating" | "completed" | "failed",
  lastError?: string | null,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("pipeline_runs")
    .update({
      evaluation_status: status,
      ...(lastError ? { last_error: lastError } : {}),
    })
    .eq("id", pipelineRunId)
    .eq("user_id", userId);
  if (error) {
    throw new Error(`Failed to update pipeline run: ${error.message}`);
  }
}
