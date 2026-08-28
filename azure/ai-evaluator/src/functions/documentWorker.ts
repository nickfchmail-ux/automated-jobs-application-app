import { InvocationContext, StorageQueueHandler } from "@azure/functions";
import {
  generateCoverLetterForJob,
  generateTailoredResume,
} from "../lib/documents.js";
import { markDocumentVersionFailed } from "../lib/documentVersions.js";
import { getSupabase } from "../lib/supabase.js";
import type { DocumentRequestMessage } from "../shared/types.js";

/**
 * Storage Queue trigger for BOTH document queues:
 *
 *   - `resume-requests`       → resumeWorker       (generates a tailored resume)
 *   - `cover-letter-requests` → coverLetterWorker  (generates a cover letter)
 *
 * Each message is `{ type, jobId, userId, runId, version?, basedOn? }`. On
 * failure the worker writes a `failed` status + error to the job row AND the
 * `document_versions` row (scoped to the user), then RETHROWS so the storage
 * queue trigger retries with backoff (maxDequeueCount caps it).
 *
 * These are fully independent of evaluation: generating a resume never
 * depends on a cover letter (or vice-versa), and neither depends on the
 * evaluation queue.
 *
 * Storage queue messages arrive as a JSON STRING — parse it into the
 * DocumentRequestMessage shape.
 */
export const resumeWorker: StorageQueueHandler<
  DocumentRequestMessage
> = async (msg: DocumentRequestMessage, context: InvocationContext) => {
  const parsed =
    typeof msg === "string"
      ? (JSON.parse(msg) as DocumentRequestMessage)
      : msg;
  const { type, jobId, userId, version } = parsed ?? {};
  if (type !== "resume" || !jobId || !userId) {
    context.error(`resumeWorker: malformed message`);
    return;
  }
  context.log(`resumeWorker start: job=${jobId} user=${userId}`);

  try {
    await generateTailoredResume(parsed, (m) => context.log(`[resume] ${m}`));
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Resume generation failed";
    context.error(`resumeWorker failed: job=${jobId} ${errMsg}`);
    await markFailed("resume", jobId, userId, errMsg).catch(() => undefined);
    // Surface the per-version failure too so the overlay's building tab
    // resolves to "failed" instead of spinning forever.
    if (version) {
      await markDocumentVersionFailed({
        userId,
        jobId,
        type: "resume",
        version,
        error: errMsg,
      }).catch(() => undefined);
    }
    throw e; // Service Bus retries
  }
};

export const coverLetterWorker: StorageQueueHandler<
  DocumentRequestMessage
> = async (msg: DocumentRequestMessage, context: InvocationContext) => {
  const parsed =
    typeof msg === "string"
      ? (JSON.parse(msg) as DocumentRequestMessage)
      : msg;
  const { type, jobId, userId, version } = parsed ?? {};
  if (type !== "cover-letter" || !jobId || !userId) {
    context.error(`coverLetterWorker: malformed message`);
    return;
  }
  context.log(`coverLetterWorker start: job=${jobId} user=${userId}`);

  try {
    await generateCoverLetterForJob(parsed, (m) =>
      context.log(`[cover-letter] ${m}`),
    );
  } catch (e) {
    const errMsg =
      e instanceof Error ? e.message : "Cover letter generation failed";
    context.error(`coverLetterWorker failed: job=${jobId} ${errMsg}`);
    await markFailed("cover-letter", jobId, userId, errMsg).catch(
      () => undefined,
    );
    if (version) {
      await markDocumentVersionFailed({
        userId,
        jobId,
        type: "cover-letter",
        version,
        error: errMsg,
      }).catch(() => undefined);
    }
    throw e; // Service Bus retries
  }
};

/** Write a `failed` status + error to the job row (scoped to the owner). */
async function markFailed(
  type: "resume" | "cover-letter",
  jobId: string,
  userId: string,
  error: string,
): Promise<void> {
  const sb = getSupabase();
  const patch =
    type === "resume"
      ? {
          resume_status: "failed",
          resume_error: error.slice(0, 500),
          updated_at: new Date().toISOString(),
        }
      : {
          cover_letter_status: "failed",
          cover_letter_error: error.slice(0, 500),
          updated_at: new Date().toISOString(),
        };
  await sb.from("jobs").update(patch).eq("id", jobId).eq("user_id", userId);
}
