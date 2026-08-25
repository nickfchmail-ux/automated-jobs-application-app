"use server";

import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { CoverLetterStatus, ResumeStatus } from "@/types/api";
import { revalidatePath } from "next/cache";

/* ------------------------------------------------------------------ */
/*  On-demand document generation (tailored resume + cover letter).    */
/*                                                                     */
/*  These call the AI evaluator's `POST /api/documents/generate` Azure */
/*  Function (server-only, function key NEVER reaches the browser).    */
/*  Each artifact is generated independently on its OWN Service Bus    */
/*  queue — generating a resume does not depend on the cover letter    */
/*  (or vice-versa), and neither depends on the evaluation run.        */
/*                                                                     */
/*  Security: the function key stays server-side; the function verifies */
/*  the job belongs to the caller's `user_id`, and every DB write is   */
/*  `.eq("user_id", userId)`.                                          */
/* ------------------------------------------------------------------ */

const EVALUATOR_BASE_URL =
  process.env.NEXT_PUBLIC_EVALUATOR_URL ||
  "https://jobsautomation-evaluator.azurewebsites.net";
/**
 * Function key for the `generateDocument` HTTP trigger.
 *
 * Azure Functions gives EVERY function its own key. The evaluator's
 * `evaluate` trigger and its `generateDocument` trigger have DIFFERENT keys —
 * reusing `AZURE_EVALUATOR_KEY` (the `evaluate` key) here returns 401. Use
 * the dedicated `AZURE_EVALUATOR_DOCUMENTS_KEY` when set, falling back to
 * the evaluate key for backwards compatibility during rollouts.
 */
const EVALUATOR_FUNCTION_KEY =
  process.env.AZURE_EVALUATOR_DOCUMENTS_KEY ||
  process.env.AZURE_EVALUATOR_KEY ||
  "";

export type TriggerDocumentResult =
  | { ok: true; jobId: string; type: "resume" | "cover-letter" }
  | { ok: false; error: string };

/**
 * Start generating a tailored resume for ONE job (owned by the current user).
 * The Azure function marks `resume_status = building`, enqueues to the
 * `resume-requests` queue, and returns 202. Realtime + socket `job:state`
 * surface the completed/failed state back to the job detail page.
 */
export async function triggerResumeAction(
  jobId: string,
): Promise<TriggerDocumentResult> {
  return triggerDocument(jobId, "resume");
}

/**
 * Start generating a cover letter for ONE job (owned by the current user).
 * The Azure function marks `cover_letter_status = building`, enqueues to the
 * `cover-letter-requests` queue, and returns 202.
 */
export async function triggerCoverLetterAction(
  jobId: string,
): Promise<TriggerDocumentResult> {
  return triggerDocument(jobId, "cover-letter");
}

async function triggerDocument(
  jobId: string,
  type: "resume" | "cover-letter",
): Promise<TriggerDocumentResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${EVALUATOR_BASE_URL}/api/documents/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-functions-key": EVALUATOR_FUNCTION_KEY,
      },
      body: JSON.stringify({ jobId, userId, type }),
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body?.error ?? `Server error ${res.status}` };
    }

    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, jobId, type };
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        error: "The request took too long. Please try again.",
      };
    }
    console.error(`[triggerDocument] ${type} network error:`, e);
    return { ok: false, error: "Could not reach the document service." };
  }
}

/* ------------------------------------------------------------------ */
/*  Current state (fallback hydrate before Realtime/socket events)     */
/* ------------------------------------------------------------------ */

export type JobDocumentState = {
  fit: boolean | null;
  fit_score: number | null;
  resume_status: ResumeStatus | null;
  resume_url: string | null;
  cover_letter_status: CoverLetterStatus | null;
  cover_letter: string | null;
};

/** Read the current document-generation + fit state for a job (scoped to user). */
export async function getJobDocumentStateAction(
  jobId: string,
): Promise<
  { ok: true; state: JobDocumentState } | { ok: false; error: string }
> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "fit, fit_score, resume_status, resume_url, cover_letter_status, cover_letter",
    )
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Job not found." };

  return {
    ok: true,
    state: {
      fit: (data.fit as boolean | null) ?? null,
      fit_score: (data.fit_score as number | null) ?? null,
      resume_status: (data.resume_status as ResumeStatus | null) ?? null,
      resume_url: (data.resume_url as string | null) ?? null,
      cover_letter_status:
        (data.cover_letter_status as CoverLetterStatus | null) ?? null,
      cover_letter: (data.cover_letter as string | null) ?? null,
    },
  };
}
