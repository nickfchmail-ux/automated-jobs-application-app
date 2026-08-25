import type {
  CoverLetterStatus,
  FunnelCounts,
  JobRowStatus,
  PipelineRunStatus,
  ResumeStatus,
} from "@/types/api";

/* ------------------------------------------------------------------ */
/*  Human copy — every machine state is translated to warm, honest,   */
/*  human language. No queues, brokers, function apps or status codes  */
/*  ever reach the user.                                               */
/* ------------------------------------------------------------------ */

// ── Run (pipeline_runs.status) ────────────────────────────────────

export type RunCopyTone = "neutral" | "active" | "success" | "error";

export interface RunStatusCopy {
  label: string;
  tone: RunCopyTone;
  /** Whether the run is still in flight (live). */
  live: boolean;
}

/** Run statuses the mapper can be asked about (includes client-side phases). */
export type RunStatusInput =
  | PipelineRunStatus
  | "starting"
  | "evaluating"
  | "idle";

export function runStatusCopy(status: RunStatusInput): RunStatusCopy {
  switch (status) {
    case "idle":
    case "starting":
      return { label: "Getting ready…", tone: "neutral", live: true };
    case "queued":
      return { label: "In line…", tone: "neutral", live: true };
    case "scraping":
      return { label: "Searching the job boards…", tone: "active", live: true };
    case "processing":
      return {
        label: "Loading job details…",
        tone: "active",
        live: true,
      };
    case "evaluating":
      return {
        label: "Matching jobs against your resume…",
        tone: "active",
        live: true,
      };
    case "retrying":
      return { label: "Hitting a snag, retrying…", tone: "active", live: true };
    case "completed":
      return { label: "Done ✓", tone: "success", live: false };
    case "failed":
      return {
        label: "Something went wrong — retry",
        tone: "error",
        live: false,
      };
    default:
      // Safety net — never return undefined, so the UI can't crash.
      return { label: "Getting ready…", tone: "neutral", live: true };
  }
}

// ── Evaluation (pipeline_runs.evaluation_status) ──────────────────

export type EvaluationCopyTone = "neutral" | "active" | "success" | "error";

export interface EvaluationStatusCopy {
  label: string;
  tone: EvaluationCopyTone;
  live: boolean;
}

/** pipeline_runs.evaluation_status → human copy. */
export function evaluationStatusCopy(
  status: string | null | undefined,
): EvaluationStatusCopy {
  switch (status) {
    case "none":
    case null:
    case undefined:
      return { label: "Not evaluated yet", tone: "neutral", live: false };
    case "queued":
      return { label: "Waiting to evaluate…", tone: "neutral", live: true };
    case "evaluating":
      return {
        label: "Matching jobs against your resume…",
        tone: "active",
        live: true,
      };
    case "completed":
      return { label: "Evaluated ✓", tone: "success", live: false };
    case "failed":
      return { label: "Evaluation failed", tone: "error", live: false };
    default:
      return { label: "Not evaluated yet", tone: "neutral", live: false };
  }
}

// ── Job (jobs.status) ─────────────────────────────────────────────

export type JobCopyTone = "neutral" | "active" | "success" | "error" | "muted";

export interface JobStatusCopy {
  label: string;
  tone: JobCopyTone;
}

/** Statuses that map to the same "Matching your resume…" copy. */
const MATCHING_STATUSES: JobRowStatus[] = [
  "processing",
  "enriching",
  "analysing",
];

export function jobStatusCopy(status: JobRowStatus): JobStatusCopy {
  switch (status) {
    case "discovered":
      return { label: "Found", tone: "neutral" };
    case "queued":
      return { label: "In line", tone: "neutral" };
    case "scraping":
      return { label: "Reading the full ad…", tone: "active" };
    case "processing":
    case "enriching":
    case "analysing":
      return { label: "Matching your resume…", tone: "active" };
    case "analysed":
      return { label: "Scored ✓", tone: "success" };
    case "completed":
      return { label: "Analysed ✓", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "error" };
    case "duplicate":
      return { label: "Already saved", tone: "muted" };
  }
}

export function isMatchingStatus(status: JobRowStatus): boolean {
  return MATCHING_STATUSES.includes(status);
}

// ── Evaluation batch (evaluation_runs.status) ─────────────────────

export type EvaluationBatchTone = "neutral" | "active" | "success" | "error";

export interface EvaluationBatchCopy {
  label: string;
  tone: EvaluationBatchTone;
  live: boolean;
}

/** evaluation_runs.status → human copy for a keyword batch. */
export function evaluationBatchCopy(
  status: string | null | undefined,
): EvaluationBatchCopy {
  switch (status) {
    case "queued":
      return { label: "Waiting…", tone: "neutral", live: true };
    case "evaluating":
      return { label: "Matching…", tone: "active", live: true };
    case "completed":
      return { label: "Scored ✓", tone: "success", live: false };
    case "failed":
      return { label: "Failed", tone: "error", live: false };
    default:
      return { label: "Waiting…", tone: "neutral", live: true };
  }
}

/** Aggregate a keyword batch's progress as a percentage (0–100). */
export function batchProgress(batch: {
  status?: string | null;
  total_jobs: number;
  processed_jobs: number;
}): number {
  if (batch.status === "completed") return 100;
  if (batch.status === "failed") return 100;
  if (!batch.total_jobs) return 0;
  return Math.max(
    4,
    Math.min(99, Math.round((batch.processed_jobs / batch.total_jobs) * 100)),
  );
}

// ── Fit score ─────────────────────────────────────────────────────

export type FitBucket = "great" | "possible" | "low" | "not-analysed";

export interface FitBadgeCopy {
  bucket: FitBucket;
  badge: string;
  copy: string;
}

export function fitBadge(score: number | null | undefined): FitBadgeCopy {
  if (score === null || score === undefined) {
    return {
      bucket: "not-analysed",
      badge: "Not analysed",
      copy: "We haven't scored this one yet.",
    };
  }
  if (score >= 75) {
    return {
      bucket: "great",
      badge: "Great fit",
      copy: "Strong match with your profile.",
    };
  }
  if (score >= 50) {
    return {
      bucket: "possible",
      badge: "Possible fit",
      copy: "Some overlap — worth a look.",
    };
  }
  return {
    bucket: "low",
    badge: "Low fit",
    copy: "Weak match — apply only if you're keen.",
  };
}

// ── Resume status ─────────────────────────────────────────────────

export type ResumeTone = "neutral" | "active" | "success" | "error";

export interface ResumeStatusCopy {
  label: string;
  tone: ResumeTone;
  live: boolean;
}

export function resumeStatusCopy(status: ResumeStatus): ResumeStatusCopy {
  switch (status) {
    case "none":
      return { label: "Not started", tone: "neutral", live: false };
    case "ready_to_build":
      return { label: "Ready to build", tone: "neutral", live: false };
    case "building":
      return { label: "Tailoring your resume…", tone: "active", live: true };
    case "completed":
      return { label: "Resume ready ✓", tone: "success", live: false };
    case "failed":
      return { label: "Couldn't build a resume", tone: "error", live: false };
  }
}

// ── Cover letter status ──────────────────────────────────────────

export interface CoverLetterStatusCopy {
  label: string;
  tone: ResumeTone;
  live: boolean;
}

/** jobs.cover_letter_status → human copy (independent generation). */
export function coverLetterStatusCopy(
  status: CoverLetterStatus | null | undefined,
): CoverLetterStatusCopy {
  switch (status) {
    case "building":
      return {
        label: "Writing your cover letter…",
        tone: "active",
        live: true,
      };
    case "completed":
      return { label: "Cover letter ready ✓", tone: "success", live: false };
    case "failed":
      return {
        label: "Couldn't write the cover letter",
        tone: "error",
        live: false,
      };
    case "none":
    case null:
    case undefined:
    default:
      return { label: "Not started", tone: "neutral", live: false };
  }
}

// ── Run funnel progress (0–100) ───────────────────────────────────

/**
 * Derive a single progress percentage from the funnel counters.
 * Rough weighting: finding (0–40), matching (40–85), finishing (85–100).
 * Always ≤ 100 and only reaches 100 when the run is completed.
 */
export function funnelProgress(
  counts: FunnelCounts,
  runStatus?: PipelineRunStatus,
): number {
  if (runStatus === "completed") return 100;
  if (runStatus === "failed") return 100;

  const total = counts.scraped || counts.unique || 0;
  if (total <= 0) return 4; // "just started" sliver

  // Finding: how much of the (eventual) scrape is done — approximated by unique seen
  const found = Math.min(40, Math.round((counts.unique / total) * 40));

  // Matching: analysed / unique
  const matched =
    counts.unique > 0
      ? Math.min(45, Math.round((counts.analysed / counts.unique) * 45))
      : 0;

  // Finishing: completed / unique
  const finished =
    counts.unique > 0
      ? Math.min(15, Math.round((counts.completed / counts.unique) * 15))
      : 0;

  return Math.max(4, Math.min(99, found + matched + finished));
}
