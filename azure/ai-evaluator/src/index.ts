import "dotenv/config";
import { app } from "@azure/functions";

import { evaluate } from "./functions/evaluate.js";
import { evaluateStatus } from "./functions/evaluateStatus.js";
import { evaluateWorker } from "./functions/evaluateWorker.js";

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

app.serviceBusQueue("evaluateWorker", {
  queueName: "evaluation-requests",
  // Functions host resolves this to ServiceBus__fullyQualifiedNamespace +
  // ServiceBus__credential=managedidentity (the evaluator's OWN service bus).
  connection: "ServiceBus",
  handler: evaluateWorker,
});

export default app;
