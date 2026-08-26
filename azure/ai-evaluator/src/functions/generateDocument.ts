import {
  HttpHandler,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { markDocumentVersionBuilding, nextDocumentVersion } from "../lib/documentVersions.js";
import { enqueueDocumentRequest } from "../lib/serviceBus.js";
import { getSupabase } from "../lib/supabase.js";
import type {
  DocumentRequestMessage,
  DocumentTriggerResponse,
} from "../shared/types.js";

/**
 * POST /api/documents/generate
 *
 * The SINGLE entry point for on-demand document generation (tailored resume
 * OR cover letter). The frontend server action calls this with the
 * authenticated user's `user_id` (never trusted from the client alone — the
 * job must belong to that user).
 *
 * Body: { jobId, userId, type: "resume" | "cover-letter", refinement?,
 *         version?, basedOn? }
 *
 * Behavior:
 *   - Verifies the job exists AND belongs to `userId`.
 *   - Idempotent guard: if the artifact is already `completed`, returns it
 *     (does NOT re-enqueue) — UNLESS `refinement` is present (a fine-tune
 *     always regenerates).
 *   - Sets the status to `building` BEFORE enqueuing so a page refresh shows
 *     "Generating…" and the Service Bus message is already durable.
 *   - Computes (or accepts) the VERSION for this generation and marks the
 *     `document_versions` row building, so the overlay shows "Regenerating…"
 *     on the right tab over Realtime.
 *   - Enqueues ONE message to the artifact's OWN queue and returns 202.
 */
export const generateDocument: HttpHandler = async (
  req: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> => {
  context.log("generateDocument trigger invoked");

  let body: {
    jobId?: string;
    userId?: string;
    type?: string;
    /** Optional user refinement note (fine-tune the generated artifact). */
    refinement?: string;
    /** Optional explicit version this generation becomes. */
    version?: number;
    /** Optional version this generation is built FROM. */
    basedOn?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const jobId = body?.jobId;
  const userId = body?.userId;
  const type = body?.type;
  const refinement =
    typeof body?.refinement === "string" && body.refinement.trim()
      ? body.refinement.trim().slice(0, 2000)
      : undefined;
  const version =
    typeof body?.version === "number" && Number.isInteger(body.version) &&
    body.version >= 1
      ? body.version
      : undefined;
  const basedOn =
    typeof body?.basedOn === "number" && Number.isInteger(body.basedOn) &&
    body.basedOn >= 1
      ? body.basedOn
      : undefined;

  if (!jobId || !userId) {
    return json({ ok: false, error: "jobId and userId are required" }, 400);
  }
  if (type !== "resume" && type !== "cover-letter") {
    return json(
      { ok: false, error: "type must be 'resume' or 'cover-letter'" },
      400,
    );
  }

  const sb = getSupabase();
  try {
    // Ownership check — the job must belong to this user. This is the
    // security boundary: a caller can only trigger documents for their OWN
    // jobs (the same user_id is stamped on the Service Bus message and every
    // write is `.eq("user_id", userId)`).
    const { data: job, error: jobErr } = await sb
      .from("jobs")
      .select("id, resume_status, cover_letter_status, pipeline_run_id")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (jobErr) {
      return json({ error: jobErr.message }, 500);
    }
    if (!job) {
      return json({ error: "Job not found" }, 404);
    }

    const now = new Date().toISOString();

    // A refinement request ALWAYS regenerates (the user is fine-tuning an
    // existing artifact), so skip the idempotent "already ready" / "building"
    // short-circuits in that case.
    const isRefinement = !!refinement;

    // Resolve the version for THIS generation. A fine-tune creates the next
    // version unless the caller pinned one; a first-time build is v1.
    const nextVersion =
      version ?? (await nextDocumentVersion(userId, jobId, type));

    if (type === "resume") {
      // Already done → don't re-enqueue (unless refining); just report state.
      if (job.resume_status === "completed" && !isRefinement) {
        return json(
          {
            ok: true,
            jobId,
            status: "completed",
            detail: "Resume already ready.",
          },
          200,
        );
      }
      if (job.resume_status === "building" && !isRefinement) {
        return json(
          {
            ok: true,
            jobId,
            status: "building",
            detail: "Resume is being generated.",
          },
          202,
        );
      }
      // Mark building BEFORE enqueue → durable across refresh.
      await sb
        .from("jobs")
        .update({
          resume_status: "building",
          resume_started_at: now,
          resume_error: null,
          updated_at: now,
        })
        .eq("id", jobId)
        .eq("user_id", userId);
    } else {
      if (job.cover_letter_status === "completed" && !isRefinement) {
        return json(
          {
            ok: true,
            jobId,
            status: "completed",
            detail: "Cover letter already ready.",
          },
          200,
        );
      }
      if (job.cover_letter_status === "building" && !isRefinement) {
        return json(
          {
            ok: true,
            jobId,
            status: "building",
            detail: "Cover letter is being generated.",
          },
          202,
        );
      }
      await sb
        .from("jobs")
        .update({
          cover_letter_status: "building",
          cover_letter_started_at: now,
          cover_letter_error: null,
          updated_at: now,
        })
        .eq("id", jobId)
        .eq("user_id", userId);
    }

    // Mark the per-version row building so the overlay shows the spinner on
    // the correct tab over Realtime (durable across refresh).
    await markDocumentVersionBuilding({
      userId,
      jobId,
      type,
      version: nextVersion,
      refinement,
      basedOn,
    }).catch((e) => {
      context.warn(`markDocumentVersionBuilding failed (non-fatal): ${e}`);
    });

    const message: DocumentRequestMessage = {
      type,
      jobId,
      userId,
      runId: job.pipeline_run_id,
      version: nextVersion,
      basedOn,
      ...(refinement ? { refinement } : {}),
    };
    await enqueueDocumentRequest(message);

    const response: DocumentTriggerResponse = {
      ok: true,
      jobId,
      status: "building",
      detail: `${type === "resume" ? "Resume" : "Cover letter"} generation started.`,
    };
    return json(response, 202);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    context.error(`generateDocument failed: ${msg}`);
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
