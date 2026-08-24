import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { enqueueEvaluation } from "../lib/serviceBus.js";
import { getSupabase } from "../lib/supabase.js";
import type { EvaluateRequest, EvaluateResponse } from "../shared/types.js";

/**
 * POST /api/evaluate
 *
 * The single entry point for AI evaluation. Validates the run, enqueues ONE
 * message to the evaluator's OWN Service Bus queue, and returns **202
 * Accepted** immediately. The `evaluateWorker` queue trigger (this same app)
 * consumes it and runs the ENTIRE evaluation in-process — no function calling
 * another function, no fire-and-forget that can be killed after the response.
 *
 * Body: { runId, user_id, search_key? }
 */
export const evaluate: HttpHandler = async (
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> => {
  context.log("evaluate trigger invoked");

  let body: EvaluateRequest;
  try {
    body = (await req.json()) as EvaluateRequest;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const runId = body?.runId;
  const userId = body?.user_id;
  if (!runId || !userId) {
    return json({ error: "runId and user_id are required" }, 400);
  }

  /** Normalize a search key to the stored form: lowercase + underscores. */
  const normalizeKey = (s: string): string =>
    s.trim().toLowerCase().replace(/\s+/g, "_");

  const sb = getSupabase();
  try {
    // 1. The run must exist and belong to this user. The search key is read
    //    from the RUN ROW (source of truth) — never trusted from the client,
    //    which avoids the scrape-vs-evaluate keyword mismatch entirely.
    const { data: run, error: runErr } = await sb
      .from("pipeline_runs")
      .select("id, status, evaluation_status, search_key")
      .eq("id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (runErr) {
      return json({ error: runErr.message, detail: "Failed to load run" }, 500);
    }
    if (!run) {
      return json({ error: "Run not found" }, 404);
    }

    // Prefer the run row's stored search_key; fall back to a normalized
    // client-supplied key (defensive — old clients may still send it).
    const searchKey =
      (run.search_key ?? "").trim() ||
      (body?.search_key ? normalizeKey(body.search_key) : undefined);

    // 2. When a search key is provided, the evaluator runs ACCOUNT-WIDE (all
    //    unevaluated jobs with that key across every run) — it does NOT need
    //    this specific run to be "completed". So only enforce the run-status
    //    gate when evaluating run-scoped (no key).
    if (!searchKey && run.status !== "completed") {
      const active = ["queued", "scraping", "processing", "retrying"].includes(
        run.status,
      );
      return json(
        {
          error: active
            ? "The search is still running — jobs aren't ready to match yet."
            : "This search didn't finish, so there's nothing to match yet.",
        },
        409,
      );
    }

    // 3. Don't restart evaluation that's already running or done. For the
    //    account-wide (keyed) case, "done" means no unevaluated jobs remain —
    //    allow re-running so the user can match a different search key from
    //    the same run. Only block an actively-running evaluation.
    if (
      run.evaluation_status === "evaluating" ||
      run.evaluation_status === "queued"
    ) {
      return json({ error: "This run is already being matched." }, 409);
    }

    // 4. Mark queued up-front so a second click is rejected, then enqueue
    //    ONE durable message to the evaluator's own queue.
    await sb
      .from("pipeline_runs")
      .update({
        evaluation_status: "queued",
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    await enqueueEvaluation({ runId, user_id: userId, search_key: searchKey });

    const response: EvaluateResponse = {
      runId,
      keywordBatches: [],
      totalJobs: 0,
      status: "queued",
      statusUrl: `/api/evaluate/${runId}`,
    };
    return json(response, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`evaluate failed: ${msg}`);
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
