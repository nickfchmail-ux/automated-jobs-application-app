import type { EvaluateJobMessage, JobForEvaluation } from "../shared/types.js";
import { evaluateSingleJobWithLLM, generateResumeWithLLM } from "./ai.js";
import { buildResumePrompt, buildSingleJobPrompt } from "./prompts.js";
import { fetchResumeText, sanitizeResume } from "./resume.js";
import { storeGeneratedResume } from "./resumeDocuments.js";
import { enhanceResumeForPrint } from "./resumePrint.js";
import { getSupabase } from "./supabase.js";

/**
 * Evaluate ONE job post end-to-end — the body of a single fan-out worker.
 *
 *   1. Fetch + sanitize the user's resume (once per worker).
 *   2. ONE LLM call → fit + fit_score + reasons + cover letter.
 *      - fit === true  → cover letter included, and a SECOND LLM call
 *        generates the tailored resume HTML (stored in `generated-resumes`).
 *      - fit === false → cover letter null, no resume generated.
 *   3. Write the scored job row back.
 *
 * The resume is fetched here (not carried on the message) so messages stay
 * small and the batch fits within Service Bus's size limit.
 */
export async function evaluateSingleJob(
  msg: EvaluateJobMessage,
  log: (msg: string) => void,
): Promise<{ fit: boolean; score: number }> {
  const sb = getSupabase();

  // Load the one job row (fresh) so we evaluate the latest description.
  const { data: jobRow, error: jobErr } = await sb
    .from("jobs")
    .select("*")
    .eq("id", msg.jobId)
    .eq("user_id", msg.userId)
    .maybeSingle();
  if (jobErr)
    throw new Error(`Failed to load job ${msg.jobId}: ${jobErr.message}`);
  if (!jobRow) throw new Error(`Job ${msg.jobId} not found`);
  const job = jobRow as unknown as JobForEvaluation;

  // Resume (contact-stripped for evaluation; contact included for the
  // tailored resume).
  const rawResume = await fetchResumeText(msg.userId);
  const resumeText = sanitizeResume(rawResume, { includeContact: false });
  const resumeTextWithContact = sanitizeResume(rawResume, {
    includeContact: true,
  });

  // Call 1 — evaluation + cover letter (fit → letter, not-fit → null).
  const evalResult = await evaluateSingleJobWithLLM(
    buildSingleJobPrompt(resumeText, job),
  );
  if (evalResult.jobId !== job.id) {
    throw new Error(`LLM returned jobId ${evalResult.jobId} for job ${job.id}`);
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

  // Fit → generate the tailored resume HTML too. Not-fit → skip both.
  if (evalResult.fit) {
    try {
      const { resumeHtml } = await generateResumeWithLLM(
        buildResumePrompt(resumeTextWithContact, job),
      );
      const printReadyHtml = enhanceResumeForPrint(resumeHtml);
      const { resumeUrl } = await storeGeneratedResume({
        userId: msg.userId,
        jobId: job.id,
        html: printReadyHtml,
      });
      patch.resume_status = "completed";
      patch.resume_url = resumeUrl;
    } catch (e) {
      // Resume generation is a bonus artifact — a failure here must not lose
      // the fit score. Surface it on the job row as failed.
      const errMsg =
        e instanceof Error ? e.message : "Resume generation failed";
      log(`job ${job.id}: resume generation failed: ${errMsg}`);
      patch.resume_status = "failed";
      patch.resume_error = errMsg.slice(0, 500);
    }
  }

  const { error: updateErr } = await sb
    .from("jobs")
    .update(patch)
    .eq("id", job.id)
    .eq("user_id", msg.userId);
  if (updateErr) throw new Error(updateErr.message);

  log(
    `job done: job=${job.id} fit=${evalResult.fit} score=${evalResult.fit_score}`,
  );
  return { fit: evalResult.fit, score: evalResult.fit_score };
}
