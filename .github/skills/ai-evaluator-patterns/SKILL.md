---
name: ai-evaluator-patterns
description: "JobSeek AI evaluation patterns: per-job LLM scoring, fit scoring thresholds, prompts, cover-letter generation, tailored resumes, client DOCX export. Use when: AI scoring, LLM prompts, fit score, fit_reasons, cover letter, resume matching, evaluation microservice, prompt tuning, tailored resume, DOCX export."
---

# JobSeek AI Evaluator Patterns

## Three Independent Queues (Critical)

The evaluator is a single Azure Functions app with its **own** Service Bus
namespace and **THREE independent queues**, one per concern. Each scales,
retries, and fails on its own — no function-to-function call chain:

| Queue                   | Producer                                    | Consumer            | Purpose                            |
| ----------------------- | ------------------------------------------- | ------------------- | ---------------------------------- |
| `evaluation-requests`   | `evaluate` (HTTP)                           | `evaluateWorker`    | Per-job AI fit scoring (1 msg/job) |
| `resume-requests`       | `evaluateWorker` (fit) / `generateDocument` | `resumeWorker`      | Tailored resume for ONE job        |
| `cover-letter-requests` | `evaluateWorker` (fit) / `generateDocument` | `coverLetterWorker` | Cover letter for ONE job           |

Per job (evaluateWorker):

1. **One LLM call** returns fit + fit_score + reasons + justification.
2. **fit === true** → the worker enqueues ONE message to `resume-requests`
   AND ONE to `cover-letter-requests`. The DEDICATED `resumeWorker` and
   `coverLetterWorker` functions generate each artifact **independently and
   in parallel** — a resume build never blocks or depends on the cover
   letter (or vice-versa).
3. **fit === false** → no documents are enqueued (one small call, no docs).

Never chain functions over queues, and never fall back to a grouped
"one call scores the whole batch" approach — per-job calls keep responses
small (no output-token truncation) and progress can be written back per job.

Durability: Service Bus retries if a worker crashes; status lives in Supabase
(`resume_status` / `cover_letter_status`), so a page refresh mid-generation
re-hydrates `building` and the build continues server-side. On a fit-job
re-evaluation, already-completed documents are preserved (not re-enqueued).

## Files

`azure/ai-evaluator/src/lib/`:

- `ai.ts` — OpenAI-compatible client call (model config), single-job parse + LLM helpers (evaluation, resume, cover letter).
- `documents.ts` — the on-demand document builders: `generateTailoredResume` + `generateCoverLetterForJob` (owned-scoped reads/writes).
- `runEvaluator.ts` — LEGACY in-process orchestrator (tests only; the worker uses `evaluateJob.ts`).
- `evaluateJob.ts` — the ACTUAL per-job worker body (scores + enqueues fit docs).
- `prompts.ts` — the evaluation prompt + tailored-resume prompt + cover-letter prompt. Keep them centralized.
- `resume.ts` — loads/parses the user's resume for context (sanitizes PII).
- `resumeDocuments.ts` — uploads generated resume HTML to `generated-resumes`, upserts `generated_resumes`.
- `socket.ts` — POSTs to the backend `/webhook/state` so the user's socket.io room gets live `stats` (evaluation) + `job:state` (document) events.
- `serviceBus.ts` — the evaluator's OWN Service Bus senders (three queues).
- `status.ts` — `evaluation_runs` status transitions + `pipeline_runs.evaluation_status`.
- `supabase.ts` — evaluator-side Supabase writes (scores, reasons, document fields).

Functions: `evaluate` (HTTP → enqueue, 202), `evaluateWorker` (queue → score + enqueue fit docs), `evaluateStatus` (HTTP → progress), `generateDocument` (HTTP → on-demand/retry), `resumeWorker` (queue → resume), `coverLetterWorker` (queue → cover letter).

## Scoring Contract

- Each job gets `fit_score` (0–100) + `fit_reasons` (string[]).
- **Thresholds** (keep in sync everywhere):
  - `>= 75` → "Great fit"
  - `50–74` → "Possible"
  - `< 50` → "Low"
- `fit` boolean derived from the score for list pages (`/fit`, `/not-fit`).

## Cover Letters & Tailored Resumes

- **Auto-generated for fit jobs** via the dedicated `resumeWorker` /
  `coverLetterWorker` functions (each on its OWN queue), and available
  **on-demand** (via `generateDocument`) for retry or for any job.
- Fit jobs get a tailored resume HTML uploaded to the `generated-resumes`
  bucket; `jobs.resume_status` / `jobs.resume_url` mirror it for Realtime.
- Cover letters are stored as text on `jobs.cover_letter` with
  `cover_letter_status` streaming the build state.
- Client-side DOCX export uses the `docx` package (`CoverLetterActions.tsx`) — server renders plain text; the client builds the `.docx`.

## Prompts

- Write prompts to produce JSON matching the typed output in `types/api.ts` (score, reasons array, cover letter).
- Keep "no jargon" language in any user-visible copy.
- Include resume context + job fields (requirements, skills, description) — trim to fit context window.
- The resume prompt must only produce HTML grounded in the real resume — never invent facts.

## Rules

- Never block scraping on evaluation (separate function apps).
- Never store LLM/function keys in the evaluator client-accessible code.
- Preserve the `evaluation_runs` progress semantics so `EvaluationProgress` UI keeps working (processed/total per batch).
- Always set `pipeline_runs.evaluation_status` to a terminal state (completed/failed) — the whole Match flow depends on it.
- Validate score shape on both the evaluator and the Next.js type contract.
