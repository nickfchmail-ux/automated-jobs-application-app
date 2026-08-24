import { getSupabase } from "./supabase.js";
import type {
  EvaluationRunRow,
  EvaluationRunStatus,
} from "../shared/types.js";

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
