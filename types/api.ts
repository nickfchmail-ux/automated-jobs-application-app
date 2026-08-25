/* ------------------------------------------------------------------ */
/*  Types for the Jobs Automation Platform APIs                        */
/*                                                                     */
/*  - Express API server : https://ai-job-server.onrender.com          */
/*  - Azure Functions    : https://jobsautomation-fn.azurewebsites.net */
/*  - Supabase           : https://uqrgivzeklqehuqqqqyv.supabase.co    */
/*  - WebSocket (socket.io) : wss://ai-job-server.onrender.com         */
/* ------------------------------------------------------------------ */

// ── Auth ──────────────────────────────────────────────────────────

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
}

export interface AuthUser {
  id: string;
  email: string;
}

// ── Scrape trigger (Azure Function) ───────────────────────────────

export const SUPPORTED_BOARDS = [
  "jobsdb",
  "ctgoodjobs",
  "offertoday",
  "linkedin",
] as const;

export type BoardName = (typeof SUPPORTED_BOARDS)[number];

export interface ScrapeTriggerRequest {
  keyword: string;
  pages?: number;
  boards?: string[];
  user_id: string;
  country_code?: string;
}

export interface ScrapeTriggerResponse {
  runId: string;
  messageId: string;
  status: "queued";
  pollUrl: string;
}

// ── AI Evaluator microservice ────────────────────────────────────

/** POST /api/evaluate — response from the AI evaluator trigger. */
export interface EvaluateResponse {
  runId: string;
  keywordBatches: { keyword: string; jobCount: number }[];
  totalJobs: number;
  status: "queued";
  statusUrl: string;
}

/** One keyword batch in the status response. */
export interface EvaluationBatchStatus {
  id: string;
  keyword: string;
  status: EvaluationRunStatus;
  totalJobs: number;
  processedJobs: number;
  failedJobs: number;
  /** Jobs scored as a fit. */
  fitJobs?: number;
  /** Jobs scored as not a fit. */
  notFitJobs?: number;
  /** Jobs still waiting to be scored. */
  remainingJobs?: number;
  lastError: string | null;
  updatedAt: string | null;
}

/** GET /api/evaluate/{runId} — per-batch progress. */
export interface EvaluateStatusResponse {
  ok: boolean;
  runId: string;
  total: number;
  processed: number;
  failed: number;
  activeBatches: number;
  batches: EvaluationBatchStatus[];
}

// ── Live pipeline state (Express REST) ────────────────────────────

/** The funnel of counters pushed by WebSocket / fetched from REST. */
export interface FunnelCounts {
  scraped: number;
  duplicate: number;
  unique: number;
  processing: number;
  analysed: number;
  fit: number;
  unfit: number;
  cover_letter: number;
  resume_building: number;
  resume_done: number;
  resume_failed: number;
  completed: number;
  failed: number;
}

export interface StatsSummaryResponse {
  ok: boolean;
  userId: string;
  counts: FunnelCounts;
}

export interface RunSummary {
  runId: string;
  keyword: string;
  boards: string[];
  createdAt: string;
  /** pipeline_runs.status — queued|scraping|processing|completed|failed|retrying|null. */
  status: PipelineRunStatus | null;
  counts: FunnelCounts;
}

export interface StatsRunsResponse {
  ok: boolean;
  runs: RunSummary[];
}

/** Per-board lifecycle stage — what the scraper is doing for that board. */
export type BoardStage =
  | "pending"
  | "fetching"
  | "extracting"
  | "done"
  | "blocked"
  | "failed";

/** Per-board stats. The socket's `stats:boards` event carries a rich shape:
 * live counters (scraped/duplicate/unique/processing) plus a lifecycle
 * `stage`, progress, and error info. All fields optional so the REST
 * fallback (fit/completed) also works. */
export interface RunBoardStats {
  /** Lifecycle stage — the key field for per-board UX. */
  stage?: BoardStage;
  pagesFetched?: number;
  pagesTotal?: number;
  jobsFound?: number;
  jobsProcessed?: number;
  jobsFailed?: number;
  lastError?: string | null;
  displayName?: string;
  scraped?: number;
  duplicate?: number;
  unique?: number;
  processing?: number;
  fit?: number;
  completed?: number;
}

export interface StatsRunDetailResponse {
  ok: boolean;
  runId: string;
  meta: { keyword: string; boards: string[]; createdAt: string };
  counts: FunnelCounts;
  boards: Record<string, RunBoardStats>;
}

/** Socket `stats:run` payload — the live per-run funnel + per-board detail. */
export interface SocketRunEvent {
  ok: boolean;
  runId: string;
  counts: FunnelCounts;
  /** Per-board live counters (scraped/duplicate/unique/processing). */
  boards?: Record<string, RunBoardStats>;
}

/** Socket `stats:boards` payload — per-board lifecycle + counters, pushed
 * continuously from the backend (Redis). One event per board update. */
export interface SocketBoardsEvent {
  ok: boolean;
  runId?: string;
  board: string;
  stats: RunBoardStats;
}

// ── WebSocket events (socket.io) ──────────────────────────────────

export interface SocketSummaryEvent {
  ok: boolean;
  counts: FunnelCounts;
}

/** The evaluation portion of the unified socket `stats` event. */
export interface SocketEvaluationState {
  status: EvaluationStatus;
  totalJobs: number;
  processedJobs: number;
  failedJobs: number;
  activeBatches: number;
  batches: EvaluationRunRow[];
}

/** Unified `stats` socket event (backend `src/wsPush.ts` `StatsPayload`). */
export interface SocketStatsEvent {
  ok: boolean;
  summary: FunnelCounts;
  runId: string | null;
  counts: FunnelCounts;
  boards: Record<string, RunBoardStats>;
  status: PipelineRunStatus | null;
  statusLabel: string | null;
  /** AI evaluation state for the run (pushed when the evaluator notifies). */
  evaluation: SocketEvaluationState;
}

/**
 * Socket `job:state` event — the live state of ONE job, pushed by the
 * backend when a tailored resume or cover letter completes/fails.
 *
 * The job detail page listens to this (scoped to the user's room) so it can
 * show fit / resume / cover-letter state live. Supabase Realtime remains the
 * fallback for individual row changes.
 */
export interface SocketJobStateEvent {
  ok: boolean;
  jobId: string;
  fit: boolean | null;
  fit_score: number | null;
  resume_status: ResumeStatus | null;
  resume_url: string | null;
  cover_letter_status: CoverLetterStatus | null;
  cover_letter: string | null;
}

// ── Run / job / resume status machines ────────────────────────────

/** pipeline_runs.status — machine states (as stored in Supabase) */
export type PipelineRunStatus =
  | "queued"
  | "scraping"
  | "processing"
  | "retrying"
  | "completed"
  | "failed";

/** pipeline_runs.evaluation_status — overall AI evaluation state for a run. */
export type EvaluationStatus =
  | "none"
  | "queued"
  | "evaluating"
  | "completed"
  | "failed";

/** evaluation_runs.status — per-keyword batch state. */
export type EvaluationRunStatus =
  | "queued"
  | "evaluating"
  | "completed"
  | "failed";

/** A row in the `evaluation_runs` table — one keyword batch. */
export interface EvaluationRunRow {
  id: string;
  pipeline_run_id: string;
  user_id: string;
  keyword: string;
  status: EvaluationRunStatus;
  total_jobs: number;
  processed_jobs: number;
  failed_jobs: number;
  /** Jobs scored as a fit — provided by the socket payload (not the DB row). */
  fit_jobs?: number;
  /** Jobs scored as not a fit — provided by the socket payload. */
  not_fit_jobs?: number;
  /** Jobs still waiting to be scored — provided by the socket payload. */
  remaining_jobs?: number;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A `pipeline_runs` row (Supabase). The Azure `runId` maps here via `azure_run_id`. */
export interface PipelineRun {
  id: string;
  user_id: string;
  keyword: string;
  search_key: string | null;
  boards: string[];
  country_code: string | null;
  status: PipelineRunStatus;
  total_jobs: number;
  processed_jobs: number;
  failed_jobs: number;
  fit_jobs: number;
  azure_run_id: string | null;
  last_error: string | null;
  retry_count: number;
  evaluation_status: EvaluationStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** jobs.status — machine states */
export type JobRowStatus =
  | "discovered"
  | "queued"
  | "scraping"
  | "processing"
  | "enriching"
  | "analysing"
  | "analysed"
  | "completed"
  | "failed"
  | "duplicate";

/** jobs.resume_status — machine states */
export type ResumeStatus =
  | "none"
  | "ready_to_build"
  | "building"
  | "completed"
  | "failed";

/** jobs.cover_letter_status — machine states (independent generation). */
export type CoverLetterStatus = "none" | "building" | "completed" | "failed";

/** generated_resumes.status */
export type GeneratedResumeStatus =
  | "queued"
  | "building"
  | "completed"
  | "failed";
