---
name: ai-evaluator-patterns
description: "JobSeek AI evaluation patterns: per-job LLM scoring, fit scoring thresholds, prompts, cover-letter generation, tailored resumes, client DOCX export. Use when: AI scoring, LLM prompts, fit score, fit_reasons, cover letter, resume matching, evaluation microservice, prompt tuning, tailored resume, DOCX export."
---

# JobSeek AI Evaluator Patterns

## The One-Queue One-Worker Design (Critical)

The evaluator is a single Azure Functions app with its **own** Service Bus
queue. `POST /api/evaluate` enqueues ONE message and returns 202; the
`evaluateWorker` queue trigger (same app) runs the ENTIRE evaluation
in-process. There is **no function-to-function call chain** and only ONE
queue (the old `evaluateBatch → generateJobDocuments` chain is gone).

Per job:
1. **One LLM call** returns fit + fit_score + reasons + cover letter.
2. **fit === true** → a second LLM call generates the tailored resume HTML
   (stored in the `generated-resumes` bucket).
3. **fit === false** → no cover letter and no resume are produced.

Never chain functions over queues, and never fall back to a grouped
"one call scores the whole batch" approach — per-job calls keep responses
small (no output-token truncation) and progress can be written back per job.

Durability: Service Bus retries if the worker crashes; the orchestrator is
idempotent (only scores `fit_score IS NULL` jobs, clears + rewrites
`evaluation_runs` rows for the run).

## Files

`azure/ai-evaluator/src/lib/`:

- `ai.ts` — OpenAI-compatible client call (model config), single-job parse + LLM helpers.
- `runEvaluator.ts` — the in-process orchestrator (loads jobs → groups by keyword → scores each → writes back → sets evaluation_status → notifies socket).
- `prompts.ts` — the evaluation prompt + the tailored-resume prompt. Keep them centralized.
- `resume.ts` — loads/parses the user's resume for context (sanitizes PII).
- `resumeDocuments.ts` — uploads generated resume HTML to `generated-resumes`, upserts `generated_resumes`.
- `socket.ts` — POSTs to the backend `/webhook/state` so the user's socket.io room gets live `stats` (evaluation) events.
- `serviceBus.ts` — the evaluator's OWN Service Bus sender (one queue, `evaluation-requests`).
- `status.ts` — `evaluation_runs` status transitions + `pipeline_runs.evaluation_status`.
- `supabase.ts` — evaluator-side Supabase writes (scores, reasons, cover letters, resume fields).

Functions: `evaluate` (HTTP trigger → enqueue, 202), `evaluateWorker` (queue trigger → orchestrator), `evaluateStatus` (HTTP → progress).

## Scoring Contract

- Each job gets `fit_score` (0–100) + `fit_reasons` (string[]).
- **Thresholds** (keep in sync everywhere):
  - `>= 75` → "Great fit"
  - `50–74` → "Possible"
  - `< 50` → "Low"
- `fit` boolean derived from the score for list pages (`/fit`, `/not-fit`).

## Cover Letters & Tailored Resumes

- The evaluator generates `cover_letter` text per job (fit jobs only).
- Fit jobs also get a tailored resume HTML uploaded to the `generated-resumes`
  bucket; `jobs.resume_status` / `jobs.resume_url` mirror it for Realtime.
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
