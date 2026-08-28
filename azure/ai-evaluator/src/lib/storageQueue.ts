// ============================================================
//  Azure Storage Queue sender helper (FREE replacement for
//  Azure Service Bus — mandated 2026-08-28).
//
//  The evaluator's OWN queues become Storage Queues living in the
//  Function App's existing host storage (`AzureWebJobsStorage`):
//    evaluation-requests   → one msg per job (fan-out)
//    resume-requests       → one msg per tailored resume
//    cover-letter-requests → one msg per cover letter
//
//  Drop-in API for the old lib/serviceBus.ts:
//    enqueueEvaluation(body) → messageId
//    enqueueEvaluationJobs(messages[]) → void
//    enqueueDocumentRequest(msg) → messageId
// ============================================================

import { QueueClient, QueueServiceClient } from "@azure/storage-queue";
import type {
  DocumentRequestMessage,
  EvaluateJobMessage,
  EvaluateRequest,
} from "../shared/types.js";

const QUEUES = {
  evaluation: process.env["EvaluationQueue"] || "evaluation-requests",
  resume: process.env["ResumeQueue"] || "resume-requests",
  coverLetter: process.env["CoverLetterQueue"] || "cover-letter-requests",
} as const;

let _serviceClient: QueueServiceClient | null = null;
let _connString = "";

function getServiceClient(): QueueServiceClient {
  const conn = process.env["AzureWebJobsStorage"] || "";
  if (!conn) {
    throw new Error(
      "Azure Storage Queue not configured. Set AzureWebJobsStorage (the Function App host storage).",
    );
  }
  if (_serviceClient && conn === _connString) return _serviceClient;
  _connString = conn;
  _serviceClient = QueueServiceClient.fromConnectionString(conn);
  return _serviceClient;
}

function getQueue(name: string): QueueClient {
  return getServiceClient().getQueueClient(name);
}

/** Create the queue if it doesn't exist (idempotent) so sends never fail. */
async function ensureQueue(name: string): Promise<void> {
  await getQueue(name)
    .createIfNotExists()
    .catch(() => {});
}

/**
 * Guard a send against a hung Storage Queue (never block an HTTP trigger).
 *
 * NOTE: Storage Queues assign the message ID server-side (unlike Service Bus),
 * so `messageId` is only used as our caller-facing trace id — it is NOT sent
 * to the SDK. The consumers are already idempotent, so no dedup is lost.
 */
async function sendWithTimeout(
  queue: string,
  body: unknown,
  _messageId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const client = getQueue(queue);
  await ensureQueue(queue);
  // Functions storage queue trigger default messageEncoding is base64.
  const text = Buffer.from(JSON.stringify(body), "utf-8").toString("base64");
  await Promise.race([
    client.sendMessage(text),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Storage Queue send timed out")),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Enqueue one evaluation request for a run. Returns the message id.
 */
export async function enqueueEvaluation(
  body: EvaluateRequest,
): Promise<string> {
  const messageId = `eval:${body.runId}:${Date.now()}`;
  await sendWithTimeout(QUEUES.evaluation, body, messageId, 15_000);
  return messageId;
}

/**
 * Enqueue ONE message per job post — the true fan-out. Storage queue triggers
 * scale across instances, so 20 posts → up to 20 concurrent worker
 * invocations. Each message carries the job id + its evaluation_runs batch id
 * so the worker processes exactly one post and rolls up progress into the
 * right batch.
 */
export async function enqueueEvaluationJobs(
  messages: EvaluateJobMessage[],
): Promise<void> {
  const client = getQueue(QUEUES.evaluation);
  await ensureQueue(QUEUES.evaluation);
  await Promise.race([
    Promise.all(
      messages.map((m) =>
        client.sendMessage(
          Buffer.from(JSON.stringify(m), "utf-8").toString("base64"),
        ),
      ),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Storage Queue send timed out")),
        20_000,
      ),
    ),
  ]);
}

/**
 * Enqueue a document-generation request (tailored resume OR cover letter).
 *
 * `type` picks the queue so each artifact is fully independent. The messageId
 * is a stable `<type>-<jobId>-<userId>` — the consumer is idempotent, so a
 * double-click can't produce a duplicate build.
 */
export async function enqueueDocumentRequest(
  msg: DocumentRequestMessage,
): Promise<string> {
  const queue = msg.type === "resume" ? QUEUES.resume : QUEUES.coverLetter;
  const messageId = `${msg.type}:${msg.jobId}:${msg.userId}`;
  await sendWithTimeout(queue, msg, messageId);
  return messageId;
}
