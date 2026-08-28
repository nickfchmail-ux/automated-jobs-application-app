/**
 * WebSocket notify helper for the evaluator.
 *
 * The evaluator runs in Azure Functions; the live socket.io server is the
 * backend Express app (`ai-job-server`). To present evaluation state over the
 * socket, the evaluator POSTs to the backend's `/webhook/state` endpoint
 * (the same mechanism the scraper uses) whenever evaluation progress
 * changes. The backend then pushes a `stats` event to the user's room.
 *
 * Env:
 *   STATE_WEBHOOK_URL     e.g. https://ai-job-server-r2dk.onrender.com/webhook/state
 *   STATE_WEBHOOK_SECRET  shared secret sent as `x-webhook-secret`
 */
const STATE_WEBHOOK_URL = process.env.STATE_WEBHOOK_URL ?? "";
const STATE_WEBHOOK_SECRET = process.env.STATE_WEBHOOK_SECRET ?? "";

/**
 * Best-effort: tell the backend to push the latest state to a user's
 * WebSocket room. Never throws — evaluation must continue even if the
 * notification fails.
 */
export async function notifyStateChange(
  userId: string,
  runId: string,
): Promise<void> {
  if (!STATE_WEBHOOK_URL || !userId || !runId) return;
  try {
    await fetch(STATE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(STATE_WEBHOOK_SECRET
          ? { "x-webhook-secret": STATE_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ userId, runId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // non-fatal — WS push is best-effort
    console.warn(`[evaluator] notifyStateChange failed: ${err}`);
  }
}

/**
 * Best-effort: tell the backend to push the CURRENT STATE OF ONE JOB to a
 * user's WebSocket room. The backend emits a `job:state` event (scoped to
 * the user's room) carrying the job's live fit / resume / cover-letter state.
 *
 * Used by the document workers so the job detail page updates instantly when
 * a tailored resume or cover letter completes (or fails) — no polling, and
 * Supabase Realtime remains the fallback for row changes.
 */
export async function notifyJobStateChange(
  userId: string,
  jobId: string,
): Promise<void> {
  if (!STATE_WEBHOOK_URL || !userId || !jobId) return;
  try {
    await fetch(STATE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(STATE_WEBHOOK_SECRET
          ? { "x-webhook-secret": STATE_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ userId, jobId, scope: "job" }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    // non-fatal — WS push is best-effort
    console.warn(`[evaluator] notifyJobStateChange failed: ${err}`);
  }
}
