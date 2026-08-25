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

## Queues: three independent concerns (no function-to-function calls)

The evaluator owns its own Service Bus namespace with **three queues**, so
each concern scales, retries, and fails independently:

| Queue                   | Producer                  | Consumer            | Purpose                                     |
| ----------------------- | ------------------------- | ------------------- | ------------------------------------------- |
| `evaluation-requests`   | `evaluate` (HTTP)         | `evaluateWorker`    | Per-job AI fit scoring (fan-out, 1 msg/job) |
| `resume-requests`       | `generateDocument` (HTTP) | `resumeWorker`      | On-demand tailored resume for ONE job       |
| `cover-letter-requests` | `generateDocument` (HTTP) | `coverLetterWorker` | On-demand cover letter for ONE job          |

- `POST /api/evaluate` validates the run, enqueues **ONE message per job** to
  `evaluation-requests`, and returns **202**. `evaluateWorker` scores each
  job (fit + score + reasons). When a job is a **fit**, the worker ALSO
  enqueues **one message to the `resume-requests` queue and one to the
  `cover-letter-requests` queue** — so both documents are auto-generated, but
  by their OWN dedicated Azure Functions (independently + in parallel). No-fit
  jobs enqueue nothing (one small call, no documents).
- `POST /api/documents/generate` with `{ jobId, userId, type }` lets the user
  (re)generate a tailored resume OR cover letter **on demand** for any job. It
  verifies the job belongs to `userId`, marks the artifact `building`
  (durable across refresh), and enqueues ONE message to that artifact's queue.
  The `resumeWorker` / `coverLetterWorker` consume it independently.
- **Durability**: status lives in Supabase (`resume_status` /
  `cover_letter_status`). If the user refreshes the page mid-generation, the
  detail page re-reads `building` and shows "Generating…" — the Service Bus
  message is already durable, so the build continues server-side.
- **Security**: every HTTP trigger + worker verifies ownership via
  `.eq("user_id", userId)` on every query/update. RLS on `jobs` +
  `generated_resumes` additionally protects the browser/Realtime path.

This respects the **two-Service-Bus model**: the **scraper** owns its own
Service Bus in `backend-scraping-api/azure/functions`; the **evaluator** owns
its own separate Service Bus for evaluation + resume + cover letter.

- **Live state over WebSocket**: at each progress point (start, per-job,
  completion, document done) the evaluator POSTs to the backend Express app's
  `/webhook/state` endpoint (`lib/socket.ts`), which pushes a `stats` event
  to the user's socket.io room. Supabase Realtime is the fallback for
  individual row changes (fit columns, resume_status, cover_letter_status).
- **Independent scaling** is preserved: the evaluator is still a separate
  deployable app, so slow/expensive LLM calls never block scraping.
- **Cost control** stays: one LLM call per job for scoring; one call per
  requested resume; one call per requested cover letter.

## Functions

| Function            | Trigger           | Purpose                                                                  |
| ------------------- | ----------------- | ------------------------------------------------------------------------ |
| `evaluate`          | HTTP POST         | Validate the run, enqueue one message per job (202), return immediately. |
| `evaluateWorker`    | Service Bus queue | Score ONE job (fit + score + reasons).                                   |
| `evaluateStatus`    | HTTP GET          | Per-batch progress for a run (used by the frontend live UI).             |
| `generateDocument`  | HTTP POST         | Start an on-demand tailored resume / cover letter (ownership-checked).   |
| `resumeWorker`      | Service Bus queue | Generate + store a tailored resume for one job.                          |
| `coverLetterWorker` | Service Bus queue | Generate + persist a cover letter for one job.                           |

## Local development

```bash
cd azure/ai-evaluator
npm install
# fill local.settings.json with real values
npm run start          # builds then runs `func start`
```

Requires [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local).

## Environment variables (app settings)

| Variable                              | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `ServiceBus__fullyQualifiedNamespace` | Evaluator's OWN Service Bus namespace (managed identity) |
| `ServiceBus__credential`              | `managedidentity` (prod) / `connectionstring` (local)    |
| `ServiceBus__connectionString`        | SAS connection string for local dev                      |
| `EvaluationQueue`                     | Evaluation queue (default `evaluation-requests`)         |
| `ResumeQueue`                         | Resume queue (default `resume-requests`)                 |
| `CoverLetterQueue`                    | Cover-letter queue (default `cover-letter-requests`)     |
| `SupabaseUrl`                         | Supabase project URL                                     |
| `SupabaseServiceKey`                  | Service-role key (bypasses RLS for write-back)           |
| `DeepSeekBaseUrl`                     | OpenAI-compatible endpoint (default DeepSeek)            |
| `DeepSeekApiKey`                      | API key for the model provider                           |
| `DeepSeekModel`                       | Model id (e.g. `deepseek-chat`)                          |
| `EvaluationStatusTable`               | Supabase table name for run/batch status                 |
| `DefaultCountryCode`                  | Default job location country (e.g. `hk`)                 |
| `STATE_WEBHOOK_URL`                   | Backend Express `/webhook/state` URL (socket push)       |
| `STATE_WEBHOOK_SECRET`                | Shared secret for the webhook (`x-webhook-secret`)       |

## Data written back (per job)

**Evaluation** (`evaluateWorker`):

- `fit`, `fit_score` (0–100), `fit_reasons`, `not_fit_reasons`, `justification`
- `expected_salary`
- `status` → `analysed`
- For FIT jobs: enqueues `resume-requests` + `cover-letter-requests`
  (auto-generation via the dedicated workers below).

**Tailored resume** (`resumeWorker` — auto for fit, or on demand):

- `resume_status` → `building → completed | failed`
- `resume_url` / `resume_file_name` / `resume_error`
- HTML uploaded to the `generated-resumes` bucket, tracked in `generated_resumes`

**Cover letter** (`coverLetterWorker` — auto for fit, or on demand):

- `cover_letter_status` → `building → completed | failed`
- `cover_letter` (the letter text) / `cover_letter_error`

Progress is written to `evaluation_runs` (one row per keyword batch) and the
overall evaluation state is reflected on `pipeline_runs.evaluation_status`
(`none → queued → evaluating → completed / failed`).
