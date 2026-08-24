import type { JobForEvaluation } from "../shared/types.js";
import { evaluateSingleJobWithLLM, generateResumeWithLLM } from "./ai.js";
import { buildResumePrompt, buildSingleJobPrompt } from "./prompts.js";
import { fetchResumeText, sanitizeResume } from "./resume.js";
import { storeGeneratedResume } from "./resumeDocuments.js";
import { enhanceResumeForPrint } from "./resumePrint.js";
import { notifyStateChange } from "./socket.js";
import {
  setPipelineRunEvaluationStatus,
  updateEvaluationRunStatus,
} from "./status.js";
import { getSupabase } from "./supabase.js";

/**
 * In-process evaluation orchestrator.
 *
 * This replaces the old queue chain (`evaluate` → Service Bus `evaluateBatch`
 * → Service Bus `generateJobDocuments`). There is NO function calling another
 * function and no Service Bus: the `evaluate` HTTP trigger calls this directly
 * and it runs in the background of the same instance.
 *
 * Per job:
 *   1. ONE LLM call returns fit + fit_score + reasons + cover letter.
 *      - fit === true  → the cover letter is included, AND a second LLM call
 *        generates the tailored resume HTML (stored in `generated-resumes`).
 *      - fit === false → cover letter is null and no resume is generated.
 *
 * Progress is written back as jobs are scored (so a partial failure never
 * loses work), then:
 *   - per-keyword progress → `evaluation_runs`
 *   - overall state → `pipeline_runs.evaluation_status` (queued → evaluating
 *     → completed / failed) so the frontend's Match flow can finish.
 */
export async function evaluateRun(params: {
  pipelineRunId: string;
  userId: string;
  searchKey?: string;
  log: (msg: string) => void;
}): Promise<{
  totalJobs: number;
  processedJobs: number;
  failedJobs: number;
}> {
  const { pipelineRunId, userId, searchKey, log } = params;
  const sb = getSupabase();

  // Only evaluate jobs that made it through scraping and haven't been scored.
  let query = sb
    .from("jobs")
    .select("*")
    .eq("pipeline_run_id", pipelineRunId)
    .eq("user_id", userId)
    .in("status", ["completed", "analysed"])
    .is("fit_score", null)
    .limit(500);
  if (searchKey) {
    query = query.eq("search_key", searchKey);
  }
  const { data: rows, error: loadErr } = await query;
  if (loadErr) {
    throw new Error(`Failed to load jobs: ${loadErr.message}`);
  }
  const jobs = (rows ?? []) as unknown as JobForEvaluation[];
  if (jobs.length === 0) {
    throw new Error("No saved jobs found for this run yet.");
  }

  // Resume text (sanitized — no contact/PII) grounds every LLM call.
  // We fetch the raw text ONCE and derive both variants so fit jobs don't
  // re-download the resume from storage per job.
  let resumeText: string; // contact-stripped (evaluation)
  let resumeTextWithContact: string; // contact included (tailored resume)
  try {
    const rawResume = await fetchResumeText(userId);
    resumeText = sanitizeResume(rawResume, { includeContact: false });
    resumeTextWithContact = sanitizeResume(rawResume, {
      includeContact: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Resume unavailable";
    throw new Error(msg);
  }

  // Group into keyword batches so the UI can show per-keyword progress.
  const batches = groupJobs(jobs);
  const now = new Date().toISOString();

  // Idempotency: a Service Bus retry or a re-run must not create duplicate
  // evaluation_runs rows. Remove any prior rows for this run first.
  await sb
    .from("evaluation_runs")
    .delete()
    .eq("pipeline_run_id", pipelineRunId)
    .eq("user_id", userId)
    .then(({ error }) => {
      if (error) {
        throw new Error(
          `Failed to clear old evaluation runs: ${error.message}`,
        );
      }
    });

  // Create one evaluation_runs row per keyword batch.
  const { data: inserted, error: insertErr } = await sb
    .from("evaluation_runs")
    .insert(
      batches.map((batch) => ({
        pipeline_run_id: pipelineRunId,
        user_id: userId,
        keyword: batch.keyword,
        status: "queued",
        total_jobs: batch.jobs.length,
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

  await setPipelineRunEvaluationStatus(
    pipelineRunId,
    userId,
    "evaluating",
    null,
  );
  // Push the "evaluating" state to the user's WebSocket room.
  await notifyStateChange(userId, pipelineRunId);

  // Track per-batch processed/failed so the final roll-up is accurate.
  const batchCounts = new Map(
    batches.map((b) => [b.keyword, { processed: 0, failed: 0 }]),
  );

  /**
   * Concurrent worker pool — fires the LLM calls for ALL jobs at (nearly)
   * the same time, bounded by a concurrency limit so we don't hammer the
   * model provider. Results are written back per-job as they complete, so
   * progress streams live to the frontend.
   *
   * Each worker: evaluation LLM call (fit + cover letter) → if fit, resume
   * LLM call + storage (concurrently) → write the job row → roll up batch.
   */
  const CONCURRENCY = Number(process.env["EVALUATION_CONCURRENCY"] || 20);
  const workerCount = Math.max(1, Math.min(CONCURRENCY, jobs.length));
  let nextIndex = 0;
  let processed = 0;
  let failed = 0;

  async function processJob(job: JobForEvaluation): Promise<void> {
    const batch = batches.find((b) => b.jobs.some((j) => j.id === job.id));
    const runId = batch ? runIdByKeyword.get(batch.keyword) : undefined;
    const counts = batch ? batchCounts.get(batch.keyword) : undefined;

    try {
      // Call 1 — evaluation + cover letter (fit → letter, not-fit → null).
      const evalResult = await evaluateSingleJobWithLLM(
        buildSingleJobPrompt(resumeText, job),
      );
      if (evalResult.jobId !== job.id) {
        throw new Error(
          `LLM returned jobId ${evalResult.jobId} for job ${job.id}`,
        );
      }

      const patch: Record<string, unknown> = {
        fit: evalResult.fit,
        fit_score: evalResult.fit_score,
        fit_reasons: evalResult.fit_reasons ?? [],
        not_fit_reasons: evalResult.not_fit_reasons ?? [],
        justification: evalResult.justification ?? null,
        cover_letter: evalResult.cover_letter ?? null,
        expected_salary: evalResult.expected_salary ?? null,
        status: "analysed",
        updated_at: new Date().toISOString(),
      };

      // Fit → generate the tailored resume HTML too (cover letter already
      // produced above). Not-fit → skip both.
      if (evalResult.fit) {
        try {
          const { resumeHtml } = await generateResumeWithLLM(
            buildResumePrompt(resumeTextWithContact, job),
          );
          // Wrap the raw LLM HTML with print-ready CSS (A4 page breaks,
          // break-inside: avoid, no orphan lines) so it PDFs cleanly.
          const printReadyHtml = enhanceResumeForPrint(resumeHtml);
          const { resumeUrl } = await storeGeneratedResume({
            userId,
            jobId: job.id,
            html: printReadyHtml,
          });
          patch.resume_status = "completed";
          patch.resume_url = resumeUrl;
        } catch (e) {
          // Resume generation is a bonus artifact — a failure here must not
          // lose the fit score. Surface it on the job row as failed.
          const msg =
            e instanceof Error ? e.message : "Resume generation failed";
          log(`job ${job.id}: resume generation failed: ${msg}`);
          patch.resume_status = "failed";
          patch.resume_error = msg.slice(0, 500);
        }
      }

      const { error: updateErr } = await sb
        .from("jobs")
        .update(patch)
        .eq("id", job.id)
        .eq("user_id", userId);
      if (updateErr) {
        throw new Error(updateErr.message);
      }

      processed++;
      if (counts) counts.processed++;
      log(
        `job done: job=${job.id} fit=${evalResult.fit} score=${evalResult.fit_score}`,
      );
    } catch (e) {
      failed++;
      if (counts) counts.failed++;
      const msg = e instanceof Error ? e.message : "Job evaluation failed";
      log(`job error: job=${job.id} ${msg}`);
    }

    // Roll this job's outcome up into its keyword batch row live, and push
    // the updated progress to the user's WebSocket room (best-effort).
    if (runId) {
      const inc = counts
        ? { processed_jobs: counts.processed, failed_jobs: counts.failed }
        : { processed_jobs: 1 };
      await updateEvaluationRunStatus(runId, "evaluating", inc).catch(
        () => undefined,
      );
      await notifyStateChange(userId, pipelineRunId);
    }
  }

  // Run a bounded number of workers concurrently; each worker pulls the next
  // job from the shared index so all LLM calls start almost simultaneously.
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < jobs.length) {
        const i = nextIndex++;
        await processJob(jobs[i]);
      }
    }),
  );

  // Final roll-up: mark every batch terminal, then set the overall status.
  for (const batch of batches) {
    const runId = runIdByKeyword.get(batch.keyword);
    if (!runId) continue;
    const counts = batchCounts.get(batch.keyword) ?? {
      processed: 0,
      failed: 0,
    };
    await updateEvaluationRunStatus(runId, "completed", {
      processed_jobs: counts.processed,
      failed_jobs: counts.failed,
      last_error:
        counts.failed > 0
          ? `${counts.failed} job(s) could not be matched.`
          : null,
      completed_at: new Date().toISOString(),
    }).catch(() => undefined);
  }

  // Even a partially-failed run counts as "completed" for the UI — the
  // per-batch rows carry the failure detail. A fully-failed run is "failed".
  const overallStatus = processed > 0 ? "completed" : "failed";
  const lastError =
    failed > 0 ? `${failed} job(s) could not be matched.` : null;
  await setPipelineRunEvaluationStatus(
    pipelineRunId,
    userId,
    overallStatus,
    lastError,
  ).catch((e) => {
    log(`Failed to set final evaluation status: ${e.message}`);
  });
  // Push the terminal evaluation state to the user's WebSocket room.
  await notifyStateChange(userId, pipelineRunId);

  log(
    `evaluateRun done: processed=${processed} failed=${failed} (${jobs.length} jobs)`,
  );
  return {
    totalJobs: jobs.length,
    processedJobs: processed,
    failedJobs: failed,
  };
}

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
