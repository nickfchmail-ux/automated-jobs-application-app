/**
 * Shared types for the AI Evaluator microservice.
 */

/** jobs.status machine states (Supabase). */
export type JobRowStatus =
  | "discovered"
  | "queued"
  | "scraping"
  | "processing"
  | "enriching"
  | "analysing"
  | "completed"
  | "failed"
  | "duplicate";

/** pipeline_runs.status */
export type PipelineRunStatus =
  | "queued"
  | "scraping"
  | "processing"
  | "retrying"
  | "completed"
  | "failed";

/** evaluation_runs.status — the per-keyword batch machine state. */
export type EvaluationRunStatus =
  | "queued"
  | "evaluating"
  | "completed"
  | "failed";

/** A `jobs` row as the evaluator needs it. */
export interface JobForEvaluation {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  raw_description: string | null;
  short_description: string | null;
  responsibilities: string[] | null;
  requirements: string[] | null;
  benefits: string[] | null;
  skills: string[] | null;
  employment_type: string | null;
  experience_level: string | null;
  search_key: string | null;
  user_id: string;
  pipeline_run_id: string | null;
  url: string | null;
  status: JobRowStatus;
}

/** One keyword batch. */
export interface KeywordBatch {
  keyword: string;
  jobs: JobForEvaluation[];
}

export interface JobEvaluationResult {
  jobId: string;
  fit: boolean;
  fit_score: number;
  fit_reasons: string[];
  /** Plain-language why this score — a short justification. */
  justification: string | null;
  /** Specific reasons it is NOT a fit (what's missing from the resume). */
  not_fit_reasons: string[];
  cover_letter: string | null;
  expected_salary: string | null;
}

/** The HTTP trigger request body. */
export interface EvaluateRequest {
  runId: string;
  user_id: string;
  /** Optional: only evaluate jobs matching this search key (keyword). */
  search_key?: string;
}

/**
 * ONE Service Bus message per job post — the fan-out unit. The `evaluate`
 * trigger enqueues one of these per unevaluated job; each `evaluateWorker`
 * invocation (which Azure scales across instances) processes exactly one.
 */
export interface EvaluateJobMessage {
  jobId: string;
  userId: string;
  runId: string;
  /** The `evaluation_runs.id` row this job rolls up into (per-keyword batch). */
  evaluationRunId: string;
  keyword: string;
  /** Contact-stripped resume text (grounds the evaluation LLM call). */
  resumeText: string;
  /** Contact-included resume text (grounds the tailored resume). */
  resumeTextWithContact: string;
}

/** Response from the evaluate trigger. */
export interface EvaluateResponse {
  runId: string;
  keywordBatches: { keyword: string; jobCount: number }[];
  totalJobs: number;
  status: "queued";
  statusUrl: string;
}

/** Per-batch status row. */
export interface EvaluationRunRow {
  id: string;
  pipeline_run_id: string;
  user_id: string;
  keyword: string;
  status: EvaluationRunStatus;
  total_jobs: number;
  processed_jobs: number;
  failed_jobs: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
