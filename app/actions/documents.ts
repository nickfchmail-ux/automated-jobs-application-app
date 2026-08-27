"use server";

import { getUserId } from "@/lib/auth";
import { consumeEntitlement } from "@/lib/entitlements";
import { requireServiceClient } from "@/lib/supabase";
import type {
  CoverLetterStatus,
  DocumentVersion,
  ResumeStatus,
} from "@/types/api";
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
/**
 * Host (master) key for the evaluator — authorizes EVERY function, including
 * the newer `enhanceRefinement` trigger that has its OWN function key. The
 * per-function `generateDocument` key returns 401 on it, so the enhance
 * action uses this instead.
 */
const EVALUATOR_HOST_KEY =
  process.env.AZURE_EVALUATOR_HOST_KEY || EVALUATOR_FUNCTION_KEY;

export type TriggerDocumentResult =
  | { ok: true; jobId: string; type: "resume" | "cover-letter" }
  | { ok: false; error: string };

/**
 * Start generating a tailored resume for ONE job (owned by the current user).
 * The Azure function marks `resume_status = building`, enqueues to the
 * `resume-requests` queue, and returns 202. Realtime + socket `job:state`
 * surface the completed/failed state back to the job detail page.
 *
 * `refinement` — when present, the worker regenerates the resume applying the
 * user's note ON TOP of the latest completed version.
 * `basedOn` — the version number this generation is built FROM (for the
 * fine-tune version nav); the worker uses it to fetch the source document.
 */
export async function triggerResumeAction(
  jobId: string,
  refinement?: string,
  basedOn?: number,
): Promise<TriggerDocumentResult> {
  return triggerDocument(jobId, "resume", refinement, basedOn);
}

/**
 * Start generating a cover letter for ONE job (owned by the current user).
 * The Azure function marks `cover_letter_status = building`, enqueues to the
 * `cover-letter-requests` queue, and returns 202.
 */
export async function triggerCoverLetterAction(
  jobId: string,
  refinement?: string,
  basedOn?: number,
): Promise<TriggerDocumentResult> {
  return triggerDocument(jobId, "cover-letter", refinement, basedOn);
}

async function triggerDocument(
  jobId: string,
  type: "resume" | "cover-letter",
  refinement?: string,
  basedOn?: number,
): Promise<TriggerDocumentResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  // ── Entitlement gate ────────────────────────────────────────
  // Free users get ONE manual generation AND ONE fine-tune per document type
  // (lifetime). The auto-generated documents (fit auto-build) happen on the
  // backend and don't go through this action, so they're never charged.
  // A fine-tune is a regeneration (refinement present) — it consumes the
  // same per-type allowance as the initial manual generation, capped at 1.
  const entitlement = await consumeEntitlement(
    type === "resume" ? "fine_tune_resume" : "fine_tune_cover_letter",
  );
  if (!entitlement.ok) {
    if (entitlement.reason === "limit_reached") {
      return { ok: false, error: `LIMIT_REACHED: ${entitlement.message}` };
    }
    return { ok: false, error: entitlement.message };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${EVALUATOR_BASE_URL}/api/documents/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-functions-key": EVALUATOR_FUNCTION_KEY,
      },
      body: JSON.stringify({
        jobId,
        userId,
        type,
        ...(refinement ? { refinement } : {}),
        ...(basedOn ? { basedOn } : {}),
      }),
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
/*  AI-assist for the fine-tune input.                                */
/*                                                                     */
/*  Rewrites the user's rough refinement note into a clearer, specific  */
/*  instruction via the evaluator's `enhanceRefinement` function. The   */
/*  result REPLACES the user's textarea (they can still edit before    */
/*  clicking Regenerate).                                              */
/* ------------------------------------------------------------------ */

export type EnhanceRefinementResult =
  | { ok: true; enhanced: string }
  | { ok: false; error: string };

/** Ask the AI to rewrite a rough fine-tune note into a clear instruction. */
export async function enhanceRefinementAction(
  refinement: string,
  type: "resume" | "cover-letter",
): Promise<EnhanceRefinementResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };
  const note = refinement.trim();
  if (!note) return { ok: false, error: "Type something to enhance first." };

  // ── Entitlement gate ────────────────────────────────────────
  // Each Enhance consumes the SAME fine-tune quota as a Regenerate (they
  // share one pool per document type). Pre-check here to fail fast; the
  // evaluator is the authoritative enforcer and returns 402 LIMIT_REACHED
  // if this races a concurrent consume.
  const entitlement = await consumeEntitlement(
    type === "resume" ? "fine_tune_resume" : "fine_tune_cover_letter",
  );
  if (!entitlement.ok) {
    if (entitlement.reason === "limit_reached") {
      return { ok: false, error: `LIMIT_REACHED: ${entitlement.message}` };
    }
    return { ok: false, error: entitlement.message };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(
      `${EVALUATOR_BASE_URL}/api/documents/enhance-refinement`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-functions-key": EVALUATOR_HOST_KEY,
        },
        body: JSON.stringify({ userId, refinement: note, type }),
        signal: controller.signal,
        cache: "no-store",
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        ok: false,
        error:
          body?.error ?? `Server error ${res.status}`,
      };
    }
    const data = await res.json();
    const enhanced =
      typeof data?.enhanced === "string" ? data.enhanced.trim() : "";
    if (!enhanced) return { ok: false, error: "Empty AI response." };
    return { ok: true, enhanced };
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof DOMException && e.name === "AbortError") {
      return {
        ok: false,
        error: "The AI took too long. Please try again.",
      };
    }
    console.error(`[enhanceRefinementAction] network error:`, e);
    return { ok: false, error: "Could not reach the AI service." };
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
  /** Per-version document state (fine-tune) — authoritative for the overlay. */
  document_versions: DocumentVersion[];
};

/** Read the current document-generation + fit state for a job (scoped to user). */
export async function getJobDocumentStateAction(
  jobId: string,
): Promise<
  { ok: true; state: JobDocumentState } | { ok: false; error: string }
> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const supabase = requireServiceClient();
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

  // Per-version document state — the overlay's version nav source of truth.
  const { data: versions, error: vErr } = await supabase
    .from("document_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .order("version", { ascending: true });

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
      document_versions: vErr ? [] : ((versions ?? []) as DocumentVersion[]),
    },
  };
}
