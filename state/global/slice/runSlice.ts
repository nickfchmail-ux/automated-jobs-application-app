import type {
  EvaluationRunRow,
  EvaluationStatus,
  FunnelCounts,
  PipelineRunStatus,
  RunBoardStats,
} from "@/types/api";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * The client-side "live run" state machine.
 * phase mirrors the run status the user sees — in plain, human terms.
 */
export type RunPhase =
  | "idle"
  | "starting"
  | "queued"
  | "scraping"
  | "processing"
  | "retrying"
  | "evaluating"
  | "completed"
  | "failed";

/** A single job row streaming in from Supabase Realtime. */
export interface LiveJobRow {
  id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  url: string | null;
  board: string | null;
  status: string | null;
  fit: boolean | null;
  fit_score: number | null;
  resume_status: string | null;
  resume_url: string | null;
  resume_pdf_url: string | null;
  resume_error: string | null;
  posted_date: string | null;
  search_key: string | null;
  created_at: string | null;
  /** Supabase `pipeline_runs.id` (UUID) — the FK for this job's run. */
  pipeline_run_id?: string | null;
}

export const EMPTY_COUNTS: FunnelCounts = {
  scraped: 0,
  duplicate: 0,
  unique: 0,
  processing: 0,
  analysed: 0,
  fit: 0,
  unfit: 0,
  cover_letter: 0,
  resume_building: 0,
  resume_done: 0,
  resume_failed: 0,
  completed: 0,
  failed: 0,
};

interface RunState {
  phase: RunPhase;
  /** `pipeline_runs.id` (UUID) — returned by the scrape trigger as `runId`.
   *  This is the same id `jobs.pipeline_run_id` references. */
  runId: string | null;
  keyword: string | null;
  boards: string[];
  counts: FunnelCounts;
  /** Per-board breakdown, keyed by board name. Populated live from the
   *  socket `stats:run` `boards` payload (scraped/duplicate/unique/
   *  processing) and the REST fallback (scraped/fit/completed). */
  boardsDetail: Record<string, RunBoardStats>;
  /** Jobs streaming in during this run (deduped by id). */
  jobStream: LiveJobRow[];
  errorMsg: string;
  connection: "idle" | "connecting" | "connected" | "disconnected";
  /** Overall AI evaluation state for the run (pipeline_runs.evaluation_status). */
  evaluationStatus: EvaluationStatus;
  /** Per-keyword batch progress (evaluation_runs rows). */
  evaluationRuns: EvaluationRunRow[];
}

const initialState: RunState = {
  phase: "idle",
  runId: null,
  keyword: null,
  boards: [],
  counts: { ...EMPTY_COUNTS },
  boardsDetail: {},
  jobStream: [],
  errorMsg: "",
  connection: "idle",
  evaluationStatus: "none",
  evaluationRuns: [],
};

const runSlice = createSlice({
  name: "run",
  initialState,
  reducers: {
    runStarting(
      state,
      action: PayloadAction<{ keyword: string; boards: string[] }>,
    ) {
      state.phase = "starting";
      state.runId = null;
      state.keyword = action.payload.keyword;
      state.boards = action.payload.boards;
      state.counts = { ...EMPTY_COUNTS };
      state.boardsDetail = {};
      state.jobStream = [];
      state.errorMsg = "";
      state.evaluationStatus = "none";
      state.evaluationRuns = [];
    },
    runQueued(
      state,
      action: PayloadAction<{ runId: string; keyword: string }>,
    ) {
      state.phase = "queued";
      state.runId = action.payload.runId;
      state.keyword = action.payload.keyword;
    },
    runConnection(state, action: PayloadAction<RunState["connection"]>) {
      state.connection = action.payload;
    },
    runCountsUpdated(state, action: PayloadAction<FunnelCounts>) {
      state.counts = action.payload;
    },
    runBoardUpdated(
      state,
      action: PayloadAction<{
        board: string;
        stats: RunBoardStats;
      }>,
    ) {
      state.boardsDetail[action.payload.board] = action.payload.stats;
    },
    runBoardsUpdated(
      state,
      action: PayloadAction<Record<string, RunBoardStats>>,
    ) {
      // Merge per-board — never replace the whole map. The socket's
      // `stats:boards` carries rich fields (duplicate/unique/stage), while
      // the REST fallback is sparse (scraped/fit/completed). Merging keeps
      // the richer socket data even if the REST call arrives later.
      for (const [board, stats] of Object.entries(action.payload)) {
        state.boardsDetail[board] = {
          ...(state.boardsDetail[board] ?? {}),
          ...stats,
        };
      }
    },
    runStatusUpdated(state, action: PayloadAction<PipelineRunStatus>) {
      state.phase = action.payload;
    },
    /** Set the phase to evaluating (AI evaluator microservice is running). */
    runEvaluating(state) {
      state.phase = "evaluating";
      state.evaluationStatus = "evaluating";
    },
    /** Per-keyword batch progress (evaluation_runs rows). */
    evaluationRunsUpdated(state, action: PayloadAction<EvaluationRunRow[]>) {
      state.evaluationRuns = action.payload;
    },
    /** Upsert a single evaluation_runs row as it changes via Realtime. */
    evaluationRunUpserted(state, action: PayloadAction<EvaluationRunRow>) {
      const incoming = action.payload;
      const idx = state.evaluationRuns.findIndex((r) => r.id === incoming.id);
      if (idx >= 0) {
        state.evaluationRuns[idx] = {
          ...state.evaluationRuns[idx],
          ...incoming,
        };
      } else {
        state.evaluationRuns = [...state.evaluationRuns, incoming];
      }
    },
    /** Set the overall evaluation_status on pipeline_runs. */
    evaluationStatusUpdated(state, action: PayloadAction<EvaluationStatus>) {
      state.evaluationStatus = action.payload;
      // Evaluation only ever runs after scraping has fully finished, so when
      // it reaches a terminal state the run itself is done. Restore the phase
      // to "completed" so the dashboard's "Done — N great fits" state renders
      // (otherwise the phase stays stuck on "evaluating" forever).
      if (
        action.payload === "completed" ||
        action.payload === "failed"
      ) {
        state.phase = "completed";
      }
    },
    /** Set the phase to failed and surface the human error copy. */
    runError(state, action: PayloadAction<string>) {
      state.phase = "failed";
      state.errorMsg = action.payload;
    },
    runJobUpserted(state, action: PayloadAction<LiveJobRow>) {
      const incoming = action.payload;
      const idx = state.jobStream.findIndex((j) => j.id === incoming.id);
      if (idx >= 0) {
        state.jobStream[idx] = { ...state.jobStream[idx], ...incoming };
      } else {
        state.jobStream = [incoming, ...state.jobStream];
      }
    },
    runJobStreamReplaced(state, action: PayloadAction<LiveJobRow[]>) {
      state.jobStream = action.payload;
    },
    runSucceeded(state) {
      state.phase = "completed";
    },
    runFailed(state, action: PayloadAction<string>) {
      state.phase = "failed";
      state.errorMsg = action.payload;
    },
    runReset(state) {
      state.phase = "idle";
      state.runId = null;
      state.keyword = null;
      state.boards = [];
      state.counts = { ...EMPTY_COUNTS };
      state.boardsDetail = {};
      state.jobStream = [];
      state.errorMsg = "";
      state.evaluationStatus = "none";
      state.evaluationRuns = [];
    },
  },
});

export const {
  runStarting,
  runQueued,
  runConnection,
  runCountsUpdated,
  runBoardUpdated,
  runBoardsUpdated,
  runStatusUpdated,
  runEvaluating,
  evaluationRunsUpdated,
  evaluationRunUpserted,
  evaluationStatusUpdated,
  runError,
  runJobUpserted,
  runJobStreamReplaced,
  runSucceeded,
  runFailed,
  runReset,
} = runSlice.actions;

export default runSlice.reducer;
