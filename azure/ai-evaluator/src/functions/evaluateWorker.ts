import { InvocationContext, ServiceBusQueueHandler } from "@azure/functions";
import { evaluateRun } from "../lib/runEvaluator.js";
import { notifyStateChange } from "../lib/socket.js";
import { getSupabase } from "../lib/supabase.js";
import type { EvaluateRequest } from "../shared/types.js";

/**
 * Service Bus queue trigger — the evaluator's OWN queue.
 *
 * ONE queue, ONE worker: `POST /api/evaluate` enqueues a message and returns
 * 202; this trigger consumes it and runs the ENTIRE evaluation in-process
 * (scoring + cover letter + tailored resume for fit jobs). There is no
 * function-calling-function chain and no second queue — this replaces the old
 * `evaluateBatch → generateJobDocuments` Service Bus chain.
 *
 * Durability: if this worker crashes mid-run, Service Bus retries the message
 * (the orchestrator is idempotent: it only scores jobs with `fit_score IS
 * NULL`, and `evaluation_runs` rows are keyed by run + keyword).
 */
export const evaluateWorker: ServiceBusQueueHandler<EvaluateRequest> = async (
  body: EvaluateRequest,
  context: InvocationContext,
): Promise<void> => {
  const { runId, user_id: userId, search_key: searchKey } = body ?? {};
  if (!runId || !userId) {
    context.error(`evaluateWorker: missing runId/user_id in message`);
    return;
  }

  context.log(`evaluateWorker start: run=${runId} user=${userId}`);
  const sb = getSupabase();

  try {
    await evaluateRun({
      pipelineRunId: runId,
      userId,
      searchKey: searchKey?.trim() || undefined,
      log: (msg) => context.log(`[evaluateRun] ${msg}`),
    });
    context.log(`evaluateWorker done: run=${runId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`evaluateWorker failed: run=${runId} ${msg}`);
    // Mark the run failed so the frontend can show it, then swallow the
    // error so Service Bus doesn't retry forever on a persistent failure
    // (e.g. bad LLM key / no resume).
    try {
      await sb
        .from("pipeline_runs")
        .update({
          evaluation_status: "failed",
          last_error: msg.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("user_id", userId);
    } catch {
      /* ignore final-write failure */
    }
    // Push the failure state to the user's WebSocket room (best-effort).
    await notifyStateChange(userId, runId);
  }
};
