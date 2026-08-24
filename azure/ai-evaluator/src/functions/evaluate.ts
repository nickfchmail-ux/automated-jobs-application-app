import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { enqueueEvaluationJobs } from "../lib/serviceBus.js";
import { getSupabase } from "../lib/supabase.js";
import type {
  EvaluateJobMessage,
  EvaluateRequest,
  EvaluateResponse,
  JobForEvaluation,
} from "../shared/types.js";

/**
 * POST /api/evaluate
 *
 * The single entry point for AI evaluation. Loads the unevaluated jobs,
 * creates one `evaluation_runs` batch row per keyword, fetches the resume
 * ONCE, and enqueues **ONE Service Bus message PER JOB POST** — a true
 * fan-out. Azure scales the `evaluateWorker` queue trigger across instances,
 * so 20 posts → up to 20 concurrent workers, each scoring exactly one post.
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

    // 4. Load the unevaluated jobs to fan out. When a search key is given,
    //    this spans ALL runs (account-wide); otherwise it's scoped to runId.
    const normalizedKey = searchKey?.trim().toLowerCase().replace(/\s+/g, "_");
    let jobQuery = sb
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["completed", "analysed"])
      .is("fit_score", null)
      .limit(500);
    if (normalizedKey) {
      jobQuery = jobQuery.eq("search_key", normalizedKey);
    } else {
      jobQuery = jobQuery.eq("pipeline_run_id", runId);
    }
    const { data: jobRows, error: jobsErr } = await jobQuery;
    if (jobsErr) {
      return json(
        { error: jobsErr.message, detail: "Failed to load jobs" },
        500,
      );
    }
    const jobs = (jobRows ?? []) as unknown as JobForEvaluation[];
    if (jobs.length === 0) {
      return json({ error: "No saved jobs found for this run yet." }, 404);
    }

    // 5. Mark queued up-front so a second click is rejected, then create one
    //    evaluation_runs batch row per keyword and enqueue ONE message per job.
    await sb
      .from("pipeline_runs")
      .update({
        evaluation_status: "queued",
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("user_id", userId);

    const now = new Date().toISOString();
    const batches = groupJobs(jobs);
    await sb
      .from("evaluation_runs")
      .delete()
      .eq("pipeline_run_id", runId)
      .eq("user_id", userId)
      .then(({ error }) => {
        if (error) {
          throw new Error(
            `Failed to clear old evaluation runs: ${error.message}`,
          );
        }
      });

    const { data: inserted, error: insertErr } = await sb
      .from("evaluation_runs")
      .insert(
        batches.map((b) => ({
          pipeline_run_id: runId,
          user_id: userId,
          keyword: b.keyword,
          status: "queued",
          total_jobs: b.jobs.length,
          processed_jobs: 0,
          failed_jobs: 0,
          last_error: null,
          created_at: now,
          updated_at: now,
        })),
      )
      .select("id, keyword");
    if (insertErr) {
      throw new Error(`Failed to create evaluation runs: ${insertErr.message}`);
    }
    const runIdByKeyword = new Map(
      (inserted ?? []).map((r) => [r.keyword, r.id] as [string, string]),
    );

    const messages: EvaluateJobMessage[] = jobs.map((job) => {
      const keyword = (job.search_key ?? "general").trim().toLowerCase();
      const evaluationRunId = runIdByKeyword.get(keyword);
      if (!evaluationRunId) {
        throw new Error(`No evaluation run for keyword "${keyword}"`);
      }
      return {
        jobId: job.id,
        userId,
        runId,
        evaluationRunId,
        keyword,
      };
    });

    await enqueueEvaluationJobs(messages);

    const response: EvaluateResponse = {
      runId,
      keywordBatches: batches.map((b) => ({
        keyword: b.keyword,
        jobCount: b.jobs.length,
      })),
      totalJobs: jobs.length,
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

/** Group jobs by search_key (keyword); jobs without one fall into "general". */
function groupJobs(jobs: JobForEvaluation[]): {
  keyword: string;
  jobs: JobForEvaluation[];
}[] {
  const buckets = new Map<string, JobForEvaluation[]>();
  for (const job of jobs) {
    const keyword = (job.search_key ?? "general").trim().toLowerCase();
    if (!buckets.has(keyword)) buckets.set(keyword, []);
    buckets.get(keyword)!.push(job);
  }
  return [...buckets.entries()].map(([keyword, keywordJobs]) => ({
    keyword,
    jobs: keywordJobs,
  }));
}

function json(body: unknown, status: number): HttpResponseInit {
  return {
    status,
    jsonBody: body,
    headers: new Headers({ "Content-Type": "application/json" }),
  };
}
