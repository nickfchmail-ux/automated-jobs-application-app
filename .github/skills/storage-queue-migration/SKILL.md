---
name: storage-queue-migration
description: "JobSeek's Service Bus → Azure Storage Queue migration playbook. Documents the decision (totally free, app must keep working), the 6 queues being migrated, the storageQueue producer helper + app.storageQueue trigger pattern, and the constraint that Functions must stay on free Consumption (Y1). Use when: service bus migration, storage queue, messaging migration, free messaging, scrape-requests, evaluation-requests, resume-builds, resume-requests, cover-letter-requests, jobs queue, jobProcessor, scraperWorker, resumeBuildWorker, evaluateWorker, documentWorker, recoverStuckRuns."
---

# Service Bus → Azure Storage Queue Migration

## Decision (2026-08-28, mandated by the user)

> "I want it to be totally free but make the app works."

- **Aiven Kafka is NOT used** — it has no free tier (~$50-60/mo min) and forces a
  Functions plan upgrade (Kafka triggers need Flex/Premium/Dedicated). Rejected.
- **Azure Storage Queues are the free replacement** — $0, live in the existing
  Function host storage, and `app.storageQueue` triggers run on the free
  Consumption (Y1) plan.

## The 6 Queues

| Queue                   | Function App | Trigger(s)                                |
| ----------------------- | ------------ | ----------------------------------------- |
| `scrape-requests`       | Scraper      | `scraperWorker.ts`                        |
| `jobs`                  | Scraper      | `jobProcessor.ts` + `recoverStuckRuns.ts` |
| `resume-builds`         | Scraper      | `resumeBuildWorker.ts`                    |
| `evaluation-requests`   | Evaluator    | `evaluateWorker` (index.ts)               |
| `resume-requests`       | Evaluator    | `resumeWorker` (index.ts)                 |
| `cover-letter-requests` | Evaluator    | `coverLetterWorker` (index.ts)            |

## Key Pattern

### Producer — `storageQueue.ts` (replaces `serviceBus.ts`)

```ts
import { QueueClient } from "@azure/storage-queue";

const conn = process.env.AzureWebJobsStorage!; // already set on both function apps
const q = (name: string) =>
  new QueueClient(conn, name, { messageOptions: { visibilityTimeout: 0 } });

export async function enqueue(name: string, body: unknown): Promise<string> {
  const id = crypto.randomUUID();
  await Promise.race([
    q(name).sendMessage(JSON.stringify(body), { messageId: id }),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("queue send timeout")), 20_000),
    ),
  ]);
  return id;
}
```

### Trigger — `app.storageQueue(...)` (replaces `app.serviceBusQueue(...)`)

```ts
app.storageQueue("scrape-requests", {
  queueName: "scrape-requests",
  connection: "AzureWebJobsStorage", // key: use host storage
  handler: async (raw: unknown, context: InvocationContext) => {
    const body = typeof raw === "string" ? JSON.parse(raw) : raw; // SQ delivers strings
    // ... existing handler logic unchanged ...
  },
});
```

## Hard Constraints

- **Never change message bodies/shapes** — transport only.
- **Never upgrade the Functions plan** — must stay on free Consumption (Y1).
- Consumers are already idempotent (upserts/dedup) — do NOT add SB-style dedup.
- Scheduled enqueue → use `visibilityTimeout` (max 7 days).
- `connection` MUST be `AzureWebJobsStorage`.

## Cleanup After Migration

- Remove `@azure/service-bus` (+ `@azure/identity` if unused elsewhere).
- Remove `ServiceBus__*` app settings.
- Remove Service Bus resources from Bicep (`main.bicep`, `queues.bicep`).
- Delete the Service Bus namespace from Azure (jobsautomation-sbns + evaluator's).
- Verify a real end-to-end run before declaring done.
