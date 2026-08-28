import { app } from "@azure/functions";
import "dotenv/config";

import { coverLetterWorker, resumeWorker } from "./functions/documentWorker.js";
import { enhanceRefinement } from "./functions/enhanceRefinement.js";
import { evaluate } from "./functions/evaluate.js";
import { evaluateStatus } from "./functions/evaluateStatus.js";
import { evaluateWorker } from "./functions/evaluateWorker.js";
import { generateDocument } from "./functions/generateDocument.js";

app.setup({
  enableHttpStream: true,
});

app.http("evaluate", {
  methods: ["POST"],
  authLevel: "function",
  route: "evaluate",
  handler: evaluate,
});

app.http("evaluateStatus", {
  methods: ["GET"],
  authLevel: "function",
  route: "evaluate/{runId}",
  handler: evaluateStatus,
});

/**
 * POST /api/documents/generate — start a tailored resume / cover letter.
 *
 * Two paths feed this:
 *   - AUTO (fit jobs): the evaluateWorker enqueues resume-requests +
 *     cover-letter-requests directly (no HTTP call).
 *   - ON-DEMAND / retry: the frontend calls this (server-side, function key)
 *     to (re)generate an artifact for any job — e.g. a failed build, or a
 *     user who wants a resume for a not-fit job.
 *
 * The trigger validates ownership, marks the artifact `building` (durable
 * across refresh), and enqueues ONE message to the artifact's OWN queue.
 */
app.http("generateDocument", {
  methods: ["POST"],
  authLevel: "function",
  route: "documents/generate",
  handler: generateDocument,
});

/**
 * POST /api/documents/enhance-refinement — AI-assist that rewrites the user's
 * rough fine-tune note into a clearer instruction (replaces the textarea).
 */
app.http("enhanceRefinement", {
  methods: ["POST"],
  authLevel: "function",
  route: "documents/enhance-refinement",
  handler: enhanceRefinement,
});

app.storageQueue("evaluateWorker", {
  queueName: "evaluation-requests",
  // Storage Queues live in the Function App's existing host storage
  // (AzureWebJobsStorage) — FREE, no separate service, no plan upgrade.
  connection: "AzureWebJobsStorage",
  handler: evaluateWorker,
});

// ── Independent document queues (each artifact scales/retries on its own) ──
app.storageQueue("resumeWorker", {
  queueName: "resume-requests",
  connection: "AzureWebJobsStorage",
  handler: resumeWorker,
});

app.storageQueue("coverLetterWorker", {
  queueName: "cover-letter-requests",
  connection: "AzureWebJobsStorage",
  handler: coverLetterWorker,
});

export default app;
