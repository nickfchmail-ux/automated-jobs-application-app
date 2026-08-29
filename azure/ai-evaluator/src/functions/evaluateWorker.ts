import { InvocationContext, StorageQueueHandler } from "@azure/functions";
import { evaluateSingleJob } from "../lib/evaluateJob.js";
import {
  invalidateStateCache,
  notifyStateChange,
} from "../lib/socket.js";
import {
  incrementEvaluationRun,
  setPipelineRunEvaluationStatus,
} from "../lib/status.js";
import { getSupabase } from "../lib/supabase.js";
import type { EvaluateJobMessage } from "../shared/types.js";

/**
 * Storage Queue trigger — ONE invocation per job post (fan-out).
 *
 * `POST /api/evaluate` enqueues one message per unevaluated job; Azure scales
 * this trigger across instances, so 20 posts → up to 20 concurrent workers,
 * each scoring exactly one post. This replaces the old single-worker loop.
 *
 * After scoring, the worker ATOMICALLY increments its batch's progress and,
 * when it is the LAST job in the batch, finalizes the run(s).
 *
 * Storage queue messages arrive as a JSON STRING — parse it.
 */
export const evaluateWorker: StorageQueueHandler<EvaluateJobMessage> = async (
  msg: EvaluateJobMessage,
  context: InvocationContext,
): Promise<void> => {
  const parsed =
    typeof msg === "string" ? (JSON.parse(msg) as EvaluateJobMessage) : msg;
  const { jobId, userId, runId, evaluationRunId } = parsed ?? {};
  if (!jobId || !userId || !runId || !evaluationRunId) {
    context.error(`evaluateWorker: malformed message (missing ids)`);
    return;
  }

  context.log(
    `evaluateWorker start: job=${jobId} run=${runId} batch=${evaluationRunId}`,
  );
  const sb = getSupabase();

  let processed = 0;
  let failed = 0;
  let lastError: string | null = null;

  try {
    await evaluateSingleJob(msg, (m) => context.log(`[job] ${m}`));
    processed = 1;
  } catch (e) {
    failed = 1;
    lastError = e instanceof Error ? e.message : "Job evaluation failed";
    context.error(`evaluateWorker failed: job=${jobId} ${lastError}`);
  }

  // Atomically roll up this job's outcome into its batch; the RPC returns
  // whether the batch is now complete. The LAST worker finalizes.
  try {
    const res = await incrementEvaluationRun({
      evaluationRunId,
      processed,
      failed,
      lastError,
    });
    context.log(
      `batch ${evaluationRunId}: processed=${res.processed}/${res.total} failed=${res.failed} done=${res.done}`,
    );
    await notifyStateChange(userId, runId);

    if (res.done) {
      // Mark the batch terminal (completed/failed), then the run(s).
      const { error: batchErr } = await sb
        .from("evaluation_runs")
        .update({
          status: res.processed > 0 ? "completed" : "failed",
          last_error:
            res.failed > 0
              ? `${res.failed} job(s) could not be matched.`
              : null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", evaluationRunId);
      if (batchErr) {
        context.error(`finalize batch failed: ${batchErr.message}`);
      }

      const overall = res.processed > 0 ? "completed" : "failed";
      const finalErr =
        res.failed > 0 ? `${res.failed} job(s) could not be matched.` : null;
      await setPipelineRunEvaluationStatus(
        runId,
        userId,
        overall,
        finalErr,
      ).catch((e) =>
        context.error(`finalize run ${runId} failed: ${e.message}`),
      );
      // Drop the backend's Redis caches so the push below (and any later
      // status poll) reads FRESH fit/not-fit + terminal status instead of a
      // 20s-stale "evaluating" snapshot.
      await invalidateStateCache(userId, runId).catch((e) =>
        context.error(`invalidate cache ${runId} failed: ${e.message}`),
      );
      await notifyStateChange(userId, runId);
    }
  } catch (e) {
    context.error(
      `evaluateWorker rollup failed: job=${jobId} ${e instanceof Error ? e.message : String(e)}`,
    );
  }
};
