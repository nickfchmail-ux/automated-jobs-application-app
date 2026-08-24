# Azure AI Evaluator — microservice

A single Azure Functions app that evaluates scraped jobs against a user's
resume. It is intentionally decoupled from the scraping pipeline and the
Next.js app:

```
Next.js app → POST /api/evaluate (this service) → 202
                └─ enqueues ONE message to the evaluator's OWN queue
                       └─ evaluateWorker (Service Bus queue trigger, same app)
                            └─ evaluateRun (in-process orchestrator)
                                 ├─ groups a run's jobs by keyword (search_key)
                                 ├─ creates an evaluation_runs row (one per keyword batch)
                                 ├─ per job: ONE LLM call → fit + score + reasons + cover letter
                                 │    └─ fit === true → second LLM call generates the tailored
                                 │       resume HTML → stored in `generated-resumes`
                                 └─ writes fit / fit_score / fit_reasons / cover_letter /
                                    resume_status back to each jobs row in Supabase, and sets
                                    pipeline_runs.evaluation_status = completed
```

## Why one queue + one worker (no function-to-function calls)

The original design chained Azure Functions over Service Bus:

```
evaluate (HTTP) → evaluateBatch (Service Bus queue) → generateJobDocuments (Service Bus queue)
```

That required TWO queues and TWO worker functions calling each other. It is
now reduced to **one queue and one worker**:

- `POST /api/evaluate` (HTTP) validates the run, enqueues **ONE message** to
  the evaluator's own Service Bus queue (`evaluation-requests`), and returns
  **202 Accepted** immediately.
- `evaluateWorker` (Service Bus queue trigger, **this same app**) consumes it
  and runs the whole evaluation in-process. There is **no function calling
  another function** and no second queue.
- **Durability**: if the worker crashes mid-run, Service Bus retries the
  message (the orchestrator is idempotent — it only scores jobs with
  `fit_score IS NULL` and clears/rewrites `evaluation_runs` rows for the run).

This respects the **two-Service-Bus model**: the **scraper** owns its own
Service Bus in `backend-scraping-api/azure/functions`; the **evaluator** owns
its own separate Service Bus (namespace + queue) for evaluation + resume +
cover letter.

- **Live state over WebSocket**: at each progress point (start, per-job,
  completion) the evaluator POSTs to the backend Express app's
  `/webhook/state` endpoint (`lib/socket.ts`), which pushes a `stats` event
  to the user's socket.io room with the evaluation status + per-batch
  progress. Supabase Realtime is the fallback for individual row changes.
- **Independent scaling** is preserved: the evaluator is still a separate
  deployable app, so slow/expensive LLM calls never block scraping.
- **Cost control** stays: one LLM call per job for scoring, plus one extra
  call per **fit** job for the tailored resume. Not-fit jobs cost exactly one
  small call and produce no cover letter or resume.

## Functions

| Function        | Trigger | Purpose                                                                 |
| --------------- | ------- | ----------------------------------------------------------------------- |
| `evaluate`      | HTTP POST | Validate the run, enqueue one message (202 Accepted), return immediately. |
| `evaluateWorker`| Service Bus queue | Run the ENTIRE evaluation in-process (scoring + resume + cover letter). |
| `evaluateStatus`| HTTP GET  | Per-batch progress for a run (used by the frontend live UI).          |

## Local development

```bash
cd azure/ai-evaluator
npm install
# fill local.settings.json with real values
npm run start          # builds then runs `func start`
```

Requires [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local).

## Environment variables (app settings)

| Variable            | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `ServiceBus__fullyQualifiedNamespace` | Evaluator's OWN Service Bus namespace (managed identity) |
| `ServiceBus__credential` | `managedidentity` (prod) / `connectionstring` (local) |
| `ServiceBus__connectionString` | SAS connection string for local dev            |
| `EvaluationQueue`   | Evaluator's queue name (default `evaluation-requests`) |
| `SupabaseUrl`       | Supabase project URL                           |
| `SupabaseServiceKey`| Service-role key (bypasses RLS for write-back) |
| `DeepSeekBaseUrl`   | OpenAI-compatible endpoint (default DeepSeek)  |
| `DeepSeekApiKey`    | API key for the model provider                 |
| `DeepSeekModel`     | Model id (e.g. `deepseek-chat`)                |
| `EvaluationStatusTable` | Supabase table name for run/batch status   |
| `DefaultCountryCode`| Default job location country (e.g. `hk`)       |
| `STATE_WEBHOOK_URL` | Backend Express `/webhook/state` URL (socket push) |
| `STATE_WEBHOOK_SECRET` | Shared secret for the webhook (`x-webhook-secret`) |

## Data written back (per job)

- `fit`, `fit_score` (0–100), `fit_reasons`, `not_fit_reasons`, `justification`
- `cover_letter` (fit jobs only; `null` otherwise)
- `expected_salary`
- `status` → `analysed`
- `resume_status` / `resume_url` / `resume_error` (fit jobs only — tailored
  resume HTML uploaded to the `generated-resumes` bucket, tracked in
  `generated_resumes`)

Progress is written to `evaluation_runs` (one row per keyword batch) and the
overall state is reflected on `pipeline_runs.evaluation_status`
(`none → queued → evaluating → completed / failed`).
