---
name: azure-functions-development
description: "JobSeek Azure Functions development: the two function apps (scraper jobsautomation-fn, evaluator jobsautomation-evaluator), azure/ai-evaluator structure, triggers (HTTP + Service Bus queue), local dev, keys, deployment. Use when: Azure Functions, Service Bus, triggers, azure/ai-evaluator, host.json, local.settings.json, function keys, evaluateStatus, deploy functions."
---

# JobSeek Azure Functions Development

## The Two Function Apps

| App       | Base URL                                                | Purpose                                            | Key env                                            |
| --------- | ------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| Scraper   | `jobsautomation-fn`                                     | Scrape job boards, push jobs, manage pipeline runs | `NEXT_PUBLIC_AZURE_FN_URL`, `AZURE_SCRAPE_KEY`     |
| Evaluator | `jobsautomation-evaluator` (repo: `azure/ai-evaluator`) | AI-fit scoring + tailored resumes (single function) | `NEXT_PUBLIC_EVALUATOR_URL`, `AZURE_EVALUATOR_KEY` |

The evaluator is a **separate deployable microservice** so slow/expensive LLM calls never block scraping and it scales independently. It is **queue-free** — the `evaluate` HTTP trigger runs the whole evaluation in-process and returns 202.

## `azure/ai-evaluator` Structure

```
azure/ai-evaluator/
├── src/
│   ├── index.ts
│   ├── functions/        # evaluate (HTTP), evaluateWorker (SB queue), evaluateStatus (HTTP)
│   ├── lib/              # runEvaluator, ai, prompts, resume, resumeDocuments, socket, serviceBus, status, supabase
│   ├── shared/           # shared helpers
│   └── types/
├── migrations/           # 001_create_evaluation_runs.sql (evaluation_runs table + evaluation_status column)
├── host.json
├── local.settings.json
├── package.json          # npm run build (tsc), npm run watch, func host start
└── README.md
```

## Patterns

- **One queue, one worker** (`evaluateWorker` queue trigger): `POST /api/evaluate` enqueues ONE message to the evaluator's OWN Service Bus queue and returns 202; the worker runs the ENTIRE evaluation in-process (scoring + cover letter + tailored resume). No function-to-function calls, no second queue. Durable via Service Bus retry (orchestrator is idempotent).
- **In-process orchestrator** (`runEvaluator.ts`): scores each job with its own LLM call (fit + cover letter), then one more call per fit job for the tailored resume HTML.
- **Batching for display**: jobs grouped by `search_key` (keyword); each batch = one `evaluation_runs` row so the UI can show per-keyword progress.
- **Socket push** (`lib/socket.ts`): the worker POSTs to the backend Express `/webhook/state` at start/progress/completion; the backend pushes a `stats` event with `evaluation` state to the user's socket.io room. Env: `STATE_WEBHOOK_URL`, `STATE_WEBHOOK_SECRET`.
- **Triggers**:
  - `evaluate` — HTTP POST `/api/evaluate`; validates + enqueues, returns 202.
  - `evaluateWorker` — Service Bus queue trigger (evaluator's own queue); runs the whole evaluation.
  - `evaluateStatus` — HTTP GET `/api/evaluate/{runId}`; per-batch progress.
- **Status flow**: `pipeline_runs` (scrape) → `evaluation_runs` (per-keyword batch progress) → `pipeline_runs.evaluation_status` (queued → evaluating → completed / failed).
- **Two service buses**: the scraper uses the backend's Service Bus; the evaluator uses its OWN (namespace + `evaluation-requests` queue).

## Local Dev

```bash
cd azure/ai-evaluator
npm install
npm run build        # tsc
npm run watch        # incremental
func start           # run locally (reads local.settings.json)
```

`local.settings.json` holds local-only values (function keys, Supabase, LLM key) — never commit real secrets.

## Keys & Security

- Function keys are passed via `x-functions-key` header from **server actions only**.
- The Next.js app proxies via `app/actions/scrape.ts` and `app/actions/evaluate.ts`; keys never reach the browser bundle.
- `host.json` configures function worker/timeouts — don't lower timeouts for evaluation (LLM calls can be slow).

## Deployment

Follow the Azure best-practice flow (skills `azure-prepare` → `azure-validate` → `azure-deploy`). Deploy the scraper and evaluator as separate function apps. Use `azure-diagnostics` when debugging production (cold start, 401 from keys).
