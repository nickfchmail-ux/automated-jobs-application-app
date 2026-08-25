import { DefaultAzureCredential } from "@azure/identity";
import { ServiceBusClient, ServiceBusSender } from "@azure/service-bus";
import type {
  DocumentRequestMessage,
  EvaluateJobMessage,
  EvaluateRequest,
} from "../shared/types.js";

/**
 * Service Bus senders for the EVALUATOR's OWN Service Bus namespace.
 *
 * The evaluator keeps its own Service Bus (the "2nd service bus" — one for
 * scraping owned by the backend, one for evaluation + resume + cover letter
 * owned by this app). It owns THREE queues so each concern scales and retries
 * independently:
 *
 *   - `evaluation-requests`   (EvaluationQueue)   — one message PER JOB (fan-out)
 *   - `resume-requests`       (ResumeQueue)       — one message per tailored resume
 *   - `cover-letter-requests` (CoverLetterQueue)  — one message per cover letter
 *
 * Local dev: ServiceBus__connectionString (SAS)
 * Production: ServiceBus__fullyQualifiedNamespace + ServiceBus__credential=managedidentity
 */

const QUEUES = {
  evaluation: process.env["EvaluationQueue"] || "evaluation-requests",
  resume: process.env["ResumeQueue"] || "resume-requests",
  coverLetter: process.env["CoverLetterQueue"] || "cover-letter-requests",
} as const;

let _client: ServiceBusClient | null = null;
const _senders = new Map<string, ServiceBusSender>();

function getClient(): ServiceBusClient {
  if (_client) return _client;

  const connStr = process.env["ServiceBus__connectionString"];
  const fqns = process.env["ServiceBus__fullyQualifiedNamespace"];
  const credentialType =
    process.env["ServiceBus__credential"] ?? "connectionstring";

  if (connStr) {
    _client = new ServiceBusClient(connStr);
  } else if (fqns && credentialType === "managedidentity") {
    _client = new ServiceBusClient(fqns, new DefaultAzureCredential());
  } else {
    throw new Error(
      "Service Bus not configured. Set ServiceBus__connectionString (local) or ServiceBus__fullyQualifiedNamespace + ServiceBus__credential=managedidentity (prod).",
    );
  }
  return _client;
}

function getSender(queue: string): ServiceBusSender {
  const existing = _senders.get(queue);
  if (existing) return existing;
  const sender = getClient().createSender(queue);
  _senders.set(queue, sender);
  return sender;
}

/** Guard a send against a hung Service Bus (never block an HTTP trigger). */
async function sendWithTimeout(
  queue: string,
  body: unknown,
  messageId: string,
  timeoutMs = 20_000,
): Promise<void> {
  const sender = getSender(queue);
  await Promise.race([
    sender.sendMessages({
      body,
      messageId,
      contentType: "application/json",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Service Bus send timed out")),
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
 * Enqueue ONE message per job post — the true fan-out. Azure scales the queue
 * trigger across instances, so 20 posts → up to 20 concurrent worker
 * invocations. Each message carries the job id + its evaluation_runs batch id
 * so the worker processes exactly one post and rolls up progress into the
 * right batch.
 */
export async function enqueueEvaluationJobs(
  messages: EvaluateJobMessage[],
): Promise<void> {
  await Promise.race([
    getSender(QUEUES.evaluation).sendMessages(
      messages.map((m) => ({
        body: m,
        messageId: `eval-job:${m.jobId}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2)}`,
        contentType: "application/json",
      })),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Service Bus send timed out")), 20_000),
    ),
  ]);
}

/**
 * Enqueue a document-generation request (tailored resume OR cover letter).
 *
 * `type` picks the queue so each artifact is fully independent — generating a
 * resume never blocks or depends on cover-letter generation (and vice-versa).
 * Duplicate-detection uses `<type>-<jobId>-<userId>` so a double-click can't
 * enqueue a duplicate build for the same artifact+job+user.
 */
export async function enqueueDocumentRequest(
  msg: DocumentRequestMessage,
): Promise<string> {
  const queue = msg.type === "resume" ? QUEUES.resume : QUEUES.coverLetter;
  const messageId = `${msg.type}:${msg.jobId}:${msg.userId}`;
  await sendWithTimeout(queue, msg, messageId);
  return messageId;
}
