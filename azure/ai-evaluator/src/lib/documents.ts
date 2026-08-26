/**
 * Independent document generation — tailored resumes and cover letters.
 *
 * Each artifact is generated ON DEMAND by its OWN Azure Function + Service Bus
 * queue, fully decoupled from the AI evaluation run:
 *
 *   - evaluation (fit scoring) → evaluateWorker        (queue `evaluation-requests`)
 *   - tailored resume          → resumeWorker          (queue `resume-requests`)
 *   - cover letter             → coverLetterWorker     (queue `cover-letter-requests`)
 *
 * Every read/write here is scoped to `userId`, so a user can only ever
 * generate / retrieve THEIR OWN documents. The service-role key bypasses RLS
 * server-side, so we always `.eq("user_id", userId)` every query — the
 * browser additionally gets RLS on the `jobs` + `generated_resumes` tables.
 *
 * Status lives in Supabase (resume_status / cover_letter_status), so if the
 * user refreshes mid-generation the detail page re-reads `building` and shows
 * the "Generating…" state — the Service Bus message is already durable, so
 * the build continues server-side and a refresh never cuts it off.
 */
import type {
  DocumentRequestMessage,
  JobForEvaluation,
} from "../shared/types.js";
import { generateCoverLetterWithLLM, generateResumeWithLLM } from "./ai.js";
import { storeCoverLetterVersion } from "./coverLetterDocuments.js";
import {
  backfillLegacyVersion,
  fetchLatestDocumentVersionContent,
  markDocumentVersionBuilding,
  markDocumentVersionCompleted,
  markDocumentVersionFailed,
  nextDocumentVersion,
} from "./documentVersions.js";
import { buildCoverLetterPrompt, buildResumePrompt } from "./prompts.js";
import { fetchResumeText, sanitizeResume } from "./resume.js";
import { storeGeneratedResume } from "./resumeDocuments.js";
import { enhanceResumeForPrint } from "./resumePrint.js";
import { notifyJobStateChange, notifyStateChange } from "./socket.js";
import { getSupabase } from "./supabase.js";

/** Load a job row, strictly scoped to its owner. */
async function loadOwnedJob(
  jobId: string,
  userId: string,
): Promise<JobForEvaluation> {
  const sb = getSupabase();
  const { data: jobRow, error: jobErr } = await sb
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (jobErr) throw new Error(`Failed to load job ${jobId}: ${jobErr.message}`);
  if (!jobRow) throw new Error(`Job ${jobId} not found`);
  return jobRow as unknown as JobForEvaluation;
}

/**
 * Fetch the previously generated resume HTML (if any) so a refinement pass can
 * build on it rather than regenerate from scratch. Returns null when none.
 *
 * Reads the LATEST completed version (v2, v3, …) — not the unversioned
 * original — so a v2→v3 fine-tune edits v2, not the first generation.
 */
async function fetchExistingResumeHtml(
  userId: string,
  jobId: string,
): Promise<string | null> {
  return fetchLatestDocumentVersionContent({
    userId,
    jobId,
    type: "resume",
  });
}

/** The previously generated cover letter for the job (scoped to the owner). */
async function getExistingCoverLetter(
  userId: string,
  jobId: string,
): Promise<string | null> {
  try {
    // Prefer the LATEST completed version file (matches what a refinement
    // pass should edit); fall back to the inline `jobs.cover_letter`.
    const latest = await fetchLatestDocumentVersionContent({
      userId,
      jobId,
      type: "cover-letter",
    });
    if (latest) return latest;
    const sb = getSupabase();
    const { data, error } = await sb
      .from("jobs")
      .select("cover_letter")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data?.cover_letter) return null;
    return String(data.cover_letter);
  } catch {
    return null;
  }
}

/**
 * Generate a TAILORED RESUME for one job (owned by `userId`).
 *
 *  1. Fetch + sanitize the user's resume (contact included — a tailored
 *     resume carries the candidate's contact details).
 *  2. Compute the version (message-provided, else next).
 *  3. Fetch the LATEST completed version (if any) so a REFINEMENT pass edits
 *     the most recent resume, not the original.
 *  4. ONE LLM call → tailored resume HTML.
 *  5. Store to the `generated-resumes` bucket + `document_versions` row.
 *  6. Write `jobs.resume_status = completed` + `resume_url` (Realtime
 *     surfaces this to the job detail page).
 *  7. Push a socket state update (best-effort).
 */
export async function generateTailoredResume(
  msg: DocumentRequestMessage,
  log: (m: string) => void,
): Promise<void> {
  const { jobId, userId, runId, refinement } = msg;
  const job = await loadOwnedJob(jobId, userId);
  let version = msg.version;
  let basedOn = msg.basedOn;

  // Resolve + persist the building state BEFORE the (slow) LLM call so a
  // page refresh mid-generation shows "Regenerating…" on the correct tab.
  // Best-effort: if the `document_versions` table isn't migrated yet, we
  // still generate (the artifact just won't be version-tracked).
  try {
    version = version ?? (await nextDocumentVersion(userId, jobId, "resume"));
    // A fine-tune (v2+) on a LEGACY job must preserve the original as v1.
    if (version > 1) {
      await backfillLegacyVersion({
        userId,
        jobId,
        type: "resume",
      }).catch(() => undefined);
    }
    await markDocumentVersionBuilding({
      userId,
      jobId,
      type: "resume",
      version,
      refinement,
      basedOn,
    });
  } catch (e) {
    log(`document_versions state write skipped (non-fatal): ${e}`);
    version = version ?? 1;
  }

  try {
    const rawResume = await fetchResumeText(userId);
    const resumeText = sanitizeResume(rawResume, { includeContact: true });

    // Fetch the latest previously generated resume (if any) so a REFINEMENT
    // pass can build on it instead of starting from scratch.
    const existingHtml = await fetchExistingResumeHtml(userId, jobId);

    // LLM generation with the FULL job + resume context so nothing is lost.
    // The LLM reads the candidate's complete resume + the entire job posting
    // and produces a tailored, complete resume HTML. `enhanceResumeForPrint`
    // strips hyperlinks to visible text (URLs must print in PDF) + adds print
    // CSS. Uses the fast deepseek-chat model.
    const { resumeHtml } = await generateResumeWithLLM(
      buildResumePrompt(resumeText, job, refinement, existingHtml),
    );
    const printReadyHtml = enhanceResumeForPrint(resumeHtml);
    const { resumeUrl, fileName } = await storeGeneratedResume({
      userId,
      jobId,
      html: printReadyHtml,
      version,
    });

    // Record this version as completed (Realtime surfaces it to the overlay).
    // Best-effort — the `jobs` mirror below is the source of truth for the
    // card; a version-state write failure must not fail the whole generation.
    await markDocumentVersionCompleted({
      userId,
      jobId,
      type: "resume",
      version,
      url: resumeUrl,
      fileName,
    }).catch((e) => {
      log(`resume version state failed (non-fatal): ${e}`);
    });

    const sb = getSupabase();
    const { error: updErr } = await sb
      .from("jobs")
      .update({
        resume_status: "completed",
        resume_url: resumeUrl,
        resume_error: null,
        resume_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (updErr) throw new Error(updErr.message);

    if (runId) await notifyStateChange(userId, runId).catch(() => undefined);
    // Push the per-job state so the job detail page updates instantly.
    await notifyJobStateChange(userId, jobId).catch(() => undefined);
    log(`resume done: job=${jobId} v${version} url=${resumeUrl}`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Resume generation failed";
    await markDocumentVersionFailed({
      userId,
      jobId,
      type: "resume",
      version,
      error: errMsg,
    }).catch(() => undefined);
    throw e;
  }
}

/**
 * Generate a COVER LETTER for one job (owned by `userId`).
 *
 *  1. Fetch + sanitize the user's resume (contact included — a cover letter
 *     is addressed to the role/company and signed with the candidate's
 *     details).
 *  2. Compute the version (message-provided, else next).
 *  3. Fetch the LATEST completed version (if any) so a REFINEMENT pass edits
 *     the most recent letter, not the original.
 *  4. ONE LLM call → cover letter text.
 *  5. Store this generation as its own VERSION (v1, v2, …) + record the
 *     `document_versions` row (Realtime surfaces it to the overlay).
 *  6. Write `jobs.cover_letter` + `jobs.cover_letter_status = completed`
 *     (Realtime surfaces this to the job detail page).
 *  7. Push a socket state update (best-effort).
 */
export async function generateCoverLetterForJob(
  msg: DocumentRequestMessage,
  log: (m: string) => void,
): Promise<void> {
  const { jobId, userId, runId, refinement } = msg;
  const job = await loadOwnedJob(jobId, userId);
  let version = msg.version;
  const basedOn = msg.basedOn;

  // Persist the building state BEFORE the (slow) LLM call. Best-effort: if
  // the `document_versions` table isn't migrated yet, generation proceeds
  // (the artifact just won't be version-tracked).
  try {
    version =
      version ?? (await nextDocumentVersion(userId, jobId, "cover-letter"));
    // A fine-tune (v2+) on a LEGACY job must preserve the original as v1.
    if (version > 1) {
      await backfillLegacyVersion({
        userId,
        jobId,
        type: "cover-letter",
      }).catch(() => undefined);
    }
    await markDocumentVersionBuilding({
      userId,
      jobId,
      type: "cover-letter",
      version,
      refinement,
      basedOn,
    });
  } catch (e) {
    log(`document_versions state write skipped (non-fatal): ${e}`);
    version = version ?? 1;
  }

  try {
    const rawResume = await fetchResumeText(userId);
    const resumeText = sanitizeResume(rawResume, { includeContact: true });

    // The previously generated cover letter (if any) so a REFINEMENT pass can
    // edit it based on the user's note instead of starting fresh.
    const existing = await getExistingCoverLetter(userId, jobId);

    const coverLetter = await generateCoverLetterWithLLM(
      buildCoverLetterPrompt(resumeText, job, refinement, existing),
    );
    if (!coverLetter.trim()) {
      throw new Error("LLM returned an empty cover letter");
    }

    // Store this generation as its own VERSION (v1, v2, …) so the overlay's
    // version nav can flip between the original and fine-tuned letters.
    const stored = await storeCoverLetterVersion({
      userId,
      jobId,
      letter: coverLetter,
      version,
    });
    await markDocumentVersionCompleted({
      userId,
      jobId,
      type: "cover-letter",
      version,
      url: stored.url,
      fileName: stored.fileName,
    }).catch((e) => {
      log(`cover letter version state failed (non-fatal): ${e}`);
    });

    const sb = getSupabase();
    const { error: updErr } = await sb
      .from("jobs")
      .update({
        cover_letter: coverLetter,
        cover_letter_status: "completed",
        cover_letter_error: null,
        cover_letter_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (updErr) throw new Error(updErr.message);

    if (runId) await notifyStateChange(userId, runId).catch(() => undefined);
    // Push the per-job state so the job detail page updates instantly.
    await notifyJobStateChange(userId, jobId).catch(() => undefined);
    log(`cover letter done: job=${jobId} v${version}`);
  } catch (e) {
    const errMsg =
      e instanceof Error ? e.message : "Cover letter generation failed";
    await markDocumentVersionFailed({
      userId,
      jobId,
      type: "cover-letter",
      version,
      error: errMsg,
    }).catch(() => undefined);
    throw e;
  }
}
