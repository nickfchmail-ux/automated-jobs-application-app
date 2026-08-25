---
name: azure-functions-development
description: "JobSeek Azure Functions development: the two function apps (scraper jobsautomation-fn, evaluator jobsautomation-evaluator), azure/ai-evaluator structure, triggers (HTTP + Service Bus queue), local dev, keys, deployment. Use when: Azure Functions, Service Bus, triggers, azure/ai-evaluator, host.json, local.settings.json, function keys, evaluateStatus, deploy functions."
---

# JobSeek Azure Functions Development

## The Two Function Apps

| App       | Base URL                                                | Purpose                                                    | Key env                                            |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Scraper   | `jobsautomation-fn`                                     | Scrape job boards, push jobs, manage pipeline runs         | `NEXT_PUBLIC_AZURE_FN_URL`, `AZURE_SCRAPE_KEY`     |
| Evaluator | `jobsautomation-evaluator` (repo: `azure/ai-evaluator`) | AI-fit scoring + tailored resumes/cover letters (3 queues) | `NEXT_PUBLIC_EVALUATOR_URL`, `AZURE_EVALUATOR_KEY` |

The evaluator is a **separate deployable microservice** so slow/expensive LLM calls never block scraping and it scales independently. It owns its OWN Service Bus namespace with **three queues** (evaluation, resume, cover letter).

## `azure/ai-evaluator` Structure

```
azure/ai-evaluator/
├── src/
│   ├── index.ts
│   ├── functions/        # evaluate (HTTP), evaluateWorker (SB), evaluateStatus (HTTP),
│   │                     # generateDocument (HTTP), resumeWorker (SB), coverLetterWorker (SB)
│   ├── lib/              # evaluateJob, documents, ai, prompts, resume, resumeDocuments,
│   │                     # socket, serviceBus, status, supabase
│   ├── shared/           # shared helpers
│   └── types/
├── migrations/           # evaluation_runs + cover_letter_status migrations
├── infra/queues.bicep    # the evaluator's OWN Service Bus queues
├── host.json
├── local.settings.json
├── package.json          # npm run build (tsc), npm run watch, func host start
└── README.md
```

## Patterns

- **Three queues, one worker each** (`evaluateWorker`, `resumeWorker`, `coverLetterWorker`):
  `POST /api/evaluate` enqueues ONE message per job to `evaluation-requests` and returns 202;
  the worker SCORES each job (fit + score + reasons). For FIT jobs it enqueues ONE message
  to `resume-requests` AND one to `cover-letter-requests`, so the DEDICATED functions generate
  each artifact independently + in parallel. `POST /api/documents/generate` (on-demand) reuses
  the same queues for retry / any job. No function-to-function calls. Durable via Service Bus
  retry (idempotent: only scores `fit_score IS NULL`, preserves completed documents).
- **Worker body** (`evaluateJob.ts`): scores each job with its own LLM call, enqueues fit docs.
- **Document builders** (`documents.ts`): `generateTailoredResume` + `generateCoverLetterForJob`,
  strictly owner-scoped (`.eq("user_id", userId)` on every read/write).
- **Batching for display**: jobs grouped by `search_key` (keyword); each batch = one `evaluation_runs` row so the UI can show per-keyword progress.
- **Socket push** (`lib/socket.ts`): the workers POST to the backend Express `/webhook/state`;
  the backend pushes `stats` (evaluation) + `job:state` (document) events to the user's socket.io
  room. Env: `STATE_WEBHOOK_URL`, `STATE_WEBHOOK_SECRET`.
- **Triggers**:
  - `evaluate` — HTTP POST `/api/evaluate`; validates + enqueues one msg/job, returns 202.
  - `evaluateWorker` — SB queue trigger; scores one job, enqueues fit docs.
  - `evaluateStatus` — HTTP GET `/api/evaluate/{runId}`; per-batch progress.
  - `generateDocument` — HTTP POST `/api/documents/generate`; on-demand/retry resume or cover letter.
  - `resumeWorker` — SB queue trigger (`resume-requests`); generates + stores a tailored resume.
  - `coverLetterWorker` — SB queue trigger (`cover-letter-requests`); generates + persists a cover letter.
- **Status flow**: `pipeline_runs` (scrape) → `evaluation_runs` (per-keyword batch progress) → `pipeline_runs.evaluation_status` (queued → evaluating → completed / failed); `jobs.resume_status` / `jobs.cover_letter_status` stream document builds.
- **Two service buses**: the scraper uses the backend's Service Bus; the evaluator uses its OWN (namespace + `evaluation-requests` + `resume-requests` + `cover-letter-requests` queues — see `infra/queues.bicep`).

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
