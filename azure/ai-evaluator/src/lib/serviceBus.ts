import { DefaultAzureCredential } from "@azure/identity";
import { ServiceBusClient, ServiceBusSender } from "@azure/service-bus";
import type { EvaluateJobMessage, EvaluateRequest } from "../shared/types.js";

/**
 * Service Bus sender for the EVALUATOR's OWN queue.
 *
 * The evaluator keeps its own Service Bus (the "2nd service bus" — one for
 * scraping owned by the backend, one for evaluation + resume + cover letter
 * owned by this app). `POST /api/evaluate` enqueues ONE message and returns
 * 202; the `evaluateWorker` queue trigger (this same app) consumes it and runs
 * the whole in-process orchestrator.
 *
 * Local dev: ServiceBus__connectionString (SAS)
 * Production: ServiceBus__fullyQualifiedNamespace + ServiceBus__credential=managedidentity
 */

const EVALUATION_QUEUE =
  process.env["EvaluationQueue"] || "evaluation-requests";

let _client: ServiceBusClient | null = null;
let _sender: ServiceBusSender | null = null;

function getSender(): ServiceBusSender {
  if (_sender) return _sender;

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
  _sender = _client.createSender(EVALUATION_QUEUE);
  return _sender;
}

/**
 * Enqueue one evaluation request for a run. Returns the message id.
 * Guards against a hung sender with a timeout so the HTTP trigger never
 * hangs on a dead Service Bus.
 */
export async function enqueueEvaluation(
  body: EvaluateRequest,
): Promise<string> {
  const sender = getSender();
  const messageId = `eval:${body.runId}:${Date.now()}`;
  await Promise.race([
    sender.sendMessages({
      body,
      messageId,
      contentType: "application/json",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Service Bus send timed out")), 15_000),
    ),
  ]);
  return messageId;
}

/**
 * Enqueue ONE message per job post — the true fan-out. Azure scales the queue
 * trigger across instances, so 20 posts → up to 20 concurrent worker
 * invocations (bounded by `maxConcurrentCalls`). Each message carries the
 * job id + its evaluation_runs batch id so the worker processes exactly one
 * post and rolls up progress into the right batch.
 */
export async function enqueueEvaluationJobs(
  messages: EvaluateJobMessage[],
): Promise<void> {
  const sender = getSender();
  await Promise.race([
    sender.sendMessages(
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
