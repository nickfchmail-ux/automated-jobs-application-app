"use client";

import { getEvaluationRunsAction } from "@/app/actions/evaluate";
import { getRealtimeSession } from "@/app/actions/realtime";
import {
  getPipelineRunAction,
  statsRunDetailAction,
} from "@/app/actions/scrape";
import {
  clearSupabaseSession,
  getSupabaseBrowser,
  setSupabaseSession,
} from "@/lib/supabase-browser";
import {
  LiveJobRow,
  evaluationRunUpserted,
  evaluationRunsUpdated,
  evaluationStatusUpdated,
  runBoardsUpdated,
  runConnection,
  runCountsUpdated,
  runError,
  runJobStreamReplaced,
  runJobUpserted,
  runStatusUpdated,
  runSucceeded,
  runSummaryUpdated,
} from "@/state/global/slice/runSlice";
import type { RootState } from "@/state/global/store";
import type {
  EvaluationRunRow,
  EvaluationStatus,
  FunnelCounts,
  PipelineRunStatus,
  RunBoardStats,
} from "@/types/api";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Socket, io } from "socket.io-client";

/** Human copy for WebSocket auth failures — never expose the raw message. */
function friendlyConnectError(message?: string): string {
  if (!message) return "";
  if (/invalid token|missing token/i.test(message)) {
    return "Your session expired. Please sign in again.";
  }
  if (/verification failed/i.test(message)) {
    return "We couldn't reach the live service. Please try again.";
  }
  return "";
}

const JOB_SELECT =
  "id,title,company,location,salary,url,board,status,fit,fit_score,resume_status,resume_url,resume_pdf_url,resume_error,posted_date,search_key,created_at,pipeline_run_id";

/**
 * Wires the live run dashboard to:
 *  1. socket.io (`stats:summary` / `stats:run`) — the funnel counters
 *  2. Supabase Realtime — the actual job rows, run status, resume status
 *  3. Express REST (`/stats/runs/:id`) — per-board breakdown fallback
 *
 * Two effects:
 *  - A "connection" effect (keyed on `enabled`) that opens the socket + the
 *    Realtime channel ONCE and keeps them alive.
 *  - A "hydrate" effect (keyed on `runId`) that seeds run status + per-board
 *    counts and loads the job stream whenever a run is queued.
 *
 * NOTE ON IDS: `POST /api/scrape` creates a `pipeline_run` row and returns
 * its `id` as `runId`. That same id is what `jobs.pipeline_run_id` points at.
 */
export function useRealtimeRun(enabled = true) {
  const dispatch = useDispatch();
  const runId = useSelector((s: RootState) => s.run.runId);
  const runIdRef = useRef<string | null>(runId);
  const socketRef = useRef<Socket | null>(null);
  /** Accumulates per-board stages so we can tell when the whole run is done. */
  const boardStagesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    runIdRef.current = runId;
    // New run → clear the accumulated per-board stages.
    boardStagesRef.current = {};
  }, [runId]);

  /** When every board has reached a terminal stage, complete the run so the
   *  UI re-enables the search button and hides Cancel. */
  function completeIfAllBoardsDone(boardStages: Record<string, string>) {
    const entries = Object.entries(boardStages).filter(
      ([, stage]) => stage && stage !== "pending",
    );
    if (entries.length === 0) return;
    const allTerminal = entries.every(([, stage]) =>
      ["done", "failed", "blocked"].includes(stage),
    );
    if (allTerminal) {
      dispatch(runSucceeded());
    }
  }

  // ── Connection effect: open socket + Realtime channel once ─────────
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: Socket | null = null;
    let channel: ReturnType<
      ReturnType<typeof getSupabaseBrowser>["channel"]
    > | null = null;

    async function connect() {
      const { token, wsUrl } = await getRealtimeSession();
      if (disposed) return;

      if (!token || !wsUrl) {
        dispatch(runConnection("disconnected"));
        return;
      }

      setSupabaseSession(token);
      const sb = getSupabaseBrowser();

      // The `jobs` channel is managed SEPARATELY (see the runId-keyed effect
      // below) so we can push a server-side `filter` and only receive the
      // ACTIVE run's rows — not every change to every job the user owns.
      // Without that filter, every evaluator write on any job was delivered
      // over the websocket (Realtime message flood → rate limits → missed
      // updates → Supabase exhaustion).
      const pipelineFilter = runIdRef.current
        ? `id=eq.${runIdRef.current}`
        : undefined;
      channel = sb
        .channel("jobs-meta")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "pipeline_runs",
            ...(pipelineFilter ? { filter: pipelineFilter } : {}),
          } as {
            event: "*";
            schema: "public";
            table: "pipeline_runs";
            filter?: string;
          },
          (payload) => {
            const row = payload.new as {
              id?: string;
              status?: PipelineRunStatus;
              last_error?: string | null;
              evaluation_status?: EvaluationStatus | null;
              [key: string]: unknown;
            };
            if (!row?.id) return;
            if (runIdRef.current && row.id !== runIdRef.current) return;
            if (row.status) {
              dispatch(runStatusUpdated(row.status));
              if (row.status === "failed" && row.last_error) {
                dispatch(runError(row.last_error));
              }
            }
            if (row.evaluation_status) {
              dispatch(evaluationStatusUpdated(row.evaluation_status));
            }
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "evaluation_runs",
            // Evaluation progress streams for the active run's batches only —
            // account-wide evals are handled by the socket `stats` event, so
            // this channel is a per-run fallback (RLS still scopes to user).
            ...(runIdRef.current
              ? { filter: `pipeline_run_id=eq.${runIdRef.current}` }
              : {}),
          } as {
            event: "*";
            schema: "public";
            table: "evaluation_runs";
            filter?: string;
          },
          (payload) => {
            const row = payload.new as EvaluationRunRow | null;
            if (!row?.id) return;
            if (runIdRef.current && row.pipeline_run_id !== runIdRef.current) {
              return;
            }
            dispatch(evaluationRunUpserted(row));
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "generated_resumes" },
          (payload) => {
            const row = payload.new as {
              job_id?: string;
              status?: string;
              resume_url?: string | null;
              pdf_url?: string | null;
              error?: string | null;
            };
            if (!row?.job_id) return;
            dispatch(
              runJobUpserted({
                id: row.job_id,
                resume_status: row.status ?? null,
                resume_url: row.resume_url ?? null,
                resume_pdf_url: row.pdf_url ?? null,
                resume_error: row.error ?? null,
              } as LiveJobRow),
            );
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "generated_resumes" },
          (payload) => {
            const row = payload.new as {
              job_id?: string;
              status?: string;
              resume_url?: string | null;
              pdf_url?: string | null;
              error?: string | null;
            };
            if (!row?.job_id) return;
            dispatch(
              runJobUpserted({
                id: row.job_id,
                resume_status: row.status ?? null,
                resume_url: row.resume_url ?? null,
                resume_pdf_url: row.pdf_url ?? null,
                resume_error: row.error ?? null,
              } as LiveJobRow),
            );
          },
        )
        .subscribe();

      socket = io(wsUrl, {
        auth: { token },
        transports: ["websocket"],
        reconnectionAttempts: 5,
      });
      socketRef.current = socket;

      // Auth failure (e.g. expired access token) → refresh the token and
      // reconnect so the live funnel keeps flowing. Without this, a run
      // would freeze at "In line…" after the token expires even though the
      // backend is still scraping. Guarded so we don't hammer the server if
      // the token is genuinely invalid.
      let authRetries = 0;
      socket.on("connect", () => {
        authRetries = 0;
        dispatch(runConnection("connected"));
      });
      socket.on("disconnect", () => dispatch(runConnection("disconnected")));

      // ── Diagnostic: log every socket event so we can see exactly what the
      // backend emits (event names + shapes) for per-board data. Remove once
      // the board mapping is confirmed. ──
      socket.onAny((event, ...args) => {
        if (event.startsWith("stats")) {
          console.log(`[ws:${event}]`, JSON.stringify(args[0])?.slice(0, 500));
        }
      });
      socket.on("connect_error", (err: { message?: string }) => {
        dispatch(runConnection("disconnected"));
        const friendly = friendlyConnectError(err?.message);
        if (friendly) dispatch(runError(friendly));

        const isAuthError =
          /invalid token|missing token|verification failed/i.test(
            err?.message ?? "",
          );
        if (!isAuthError || authRetries >= 2) return;
        authRetries++;

        void (async () => {
          const fresh = await getRealtimeSession();
          if (disposed || !socket) return;
          if (!fresh.token || !fresh.wsUrl) return;
          socket.auth = { token: fresh.token };
          // update the Supabase session too so Realtime rows stay scoped
          setSupabaseSession(fresh.token);
          socket.connect();
        })();
      });

      // ── Unified `stats` event (backend contract, 2026-08-23) ─────────
      // The backend emits ONE `stats` event that bundles the summary + the
      // current run's counts + per-board state + run status + evaluation
      // state into a single object (see backend `src/wsPush.ts`
      // `buildStats`). The old `stats:summary` / `stats:run` /
      // `stats:boards` events are GONE.
      socket.on(
        "stats",
        (data: {
          ok: boolean;
          summary?: FunnelCounts;
          runId?: string | null;
          counts?: FunnelCounts;
          boards?: Record<string, RunBoardStats>;
          status?: string | null;
          statusLabel?: string | null;
          evaluation?: {
            status?: string | null;
            totalJobs?: number;
            processedJobs?: number;
            failedJobs?: number;
            fitJobs?: number;
            notFitJobs?: number;
            remainingJobs?: number;
            activeBatches?: number;
            batches?: (Partial<EvaluationRunRow> & {
              // Backend sends camelCase for these — the UI reads snake_case
              // (total_jobs etc.), so the mapping below converts them.
              pipelineRunId?: string | null;
              totalJobs?: number;
              processedJobs?: number;
              failedJobs?: number;
              fitJobs?: number;
              notFitJobs?: number;
              remainingJobs?: number;
              lastError?: string | null;
            })[];
          };
        }) => {
          if (!data?.ok) return;

          // Aggregate counts across all runs → the navbar badges. Kept in a
          // SEPARATE slice field (`summary`) so it never overwrites the
          // active run's `counts` — otherwise the live card would show
          // lifetime totals ("615 new") instead of this run's numbers.
          if (data.summary) dispatch(runSummaryUpdated(data.summary));

          // If this event is for the active run, surface the run-level
          // funnel + per-board state live.
          if (data.runId && runIdRef.current === data.runId) {
            if (data.counts) dispatch(runCountsUpdated(data.counts));
            if (data.boards) {
              for (const [b, s] of Object.entries(data.boards)) {
                if (s?.stage) boardStagesRef.current[b] = s.stage;
              }
              dispatch(runBoardsUpdated(data.boards));
              completeIfAllBoardsDone(boardStagesRef.current);
            }
          }

          // Evaluation state pushed over the socket by the evaluator via the
          // backend webhook. This is ACCOUNT-WIDE (a search-key evaluation
          // spans multiple runs), so it is processed REGARDLESS of which
          // runId the event carries — gating it on `runIdRef.current` made the
          // fit/not-fit counts silently drop to 0 when the evaluator's runId
          // didn't match the active run in Redux.
          if (data.evaluation) {
            if (data.evaluation.status) {
              dispatch(
                evaluationStatusUpdated(
                  data.evaluation.status as EvaluationStatus,
                ),
              );
            }
            if (data.evaluation.batches?.length) {
              // Map the socket's camelCase payload into the snake_case shape
              // the progress table + EvaluationStep read. The spread alone is
              // NOT enough — totalJobs/processedJobs/failedJobs stay camelCase
              // and the UI reads total_jobs → shows 0 ("0 of 0 jobs matched",
              // Total 0) and never reaches a terminal state it can act on.
              dispatch(
                evaluationRunsUpdated(
                  data.evaluation.batches.map(
                    (b) =>
                      ({
                        id: b.id ?? "",
                        pipeline_run_id: b.pipelineRunId ?? "",
                        keyword: b.keyword ?? "",
                        status: b.status ?? "queued",
                        total_jobs: b.totalJobs ?? 0,
                        processed_jobs: b.processedJobs ?? 0,
                        failed_jobs: b.failedJobs ?? 0,
                        fit_jobs: b.fitJobs ?? 0,
                        not_fit_jobs: b.notFitJobs ?? 0,
                        remaining_jobs: b.remainingJobs ?? 0,
                        last_error: b.lastError ?? null,
                      }) as EvaluationRunRow,
                  ),
                ),
              );
            }
          }

          // Run status → human phase. Map backend statuses to our phase.
          // Only applied when a run is actually being tracked in Redux —
          // otherwise a stale `stats` event for an old run would light up a
          // phantom live card after a page reload (when Redux runId is null).
          if (data.status && runIdRef.current) {
            const status = data.status as PipelineRunStatus;
            if (status === "queued") dispatch(runStatusUpdated("queued"));
            else if (status === "scraping")
              dispatch(runStatusUpdated("scraping"));
            else if (status === "processing")
              dispatch(runStatusUpdated("processing"));
            else if (status === "retrying")
              dispatch(runStatusUpdated("retrying"));
            else if (status === "completed") {
              // Authoritative terminal state — mark the run done even if one
              // board failed/blocked (partial failures are not fatal). Without
              // this, a single failed board could leave the phase stuck on
              // "processing" forever ("the whole page stuck").
              dispatch(runSucceeded());
            } else if (status === "failed") {
              dispatch(runStatusUpdated("failed"));
            }
          }
        },
      );
    }

    connect();

    return () => {
      disposed = true;
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
      if (channel) {
        sbChannelCleanup(channel);
      }
      clearSupabaseSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Jobs channel: server-side filtered by the ACTIVE run ──────────
  // The single biggest Supabase Realtime burner was an UNFILTERED
  // `postgres_changes` subscription on `jobs` (event "*") that delivered
  // EVERY change to EVERY job the user owns, then filtered client-side after
  // delivery. On a busy account every evaluator write (fit / fit_score /
  // resume_status on any job) was pushed over the websocket → message flood →
  // Realtime rate limits → missed updates → exhaustion.
  //
  // This effect owns the `jobs` channel and REBUILDS it when `runId` changes
  // so the filter is pushed to the server (`pipeline_run_id=eq.<runId>`). It
  // only listens for INSERT + UPDATE (new rows for the stream + status/fit
  // updates) — DELETEs are not rendered. When no run is active the channel
  // subscribes to INSERTs for the user's rows only (RLS-scoped), which is
  // essentially silent because writes happen under an active run.
  useEffect(() => {
    if (!enabled) return;
    const sb = getSupabaseBrowser();
    let jobsChannel: ReturnType<
      ReturnType<typeof getSupabaseBrowser>["channel"]
    > | null = null;
    let disposed = false;

    const runFilter = runId ? `pipeline_run_id=eq.${runId}` : undefined;

    const handleJobChange = (payload: { new: Partial<LiveJobRow> }): void => {
      if (disposed) return;
      const row = payload.new as Partial<LiveJobRow>;
      if (!row?.id) return;
      // Belt-and-braces: even with the server filter, never surface a row
      // from a different run into the active stream.
      if (runId && row.pipeline_run_id && row.pipeline_run_id !== runId) {
        return;
      }
      dispatch(runJobUpserted(row as LiveJobRow));
    };

    const baseFilter = {
      schema: "public" as const,
      table: "jobs" as const,
      ...(runFilter ? { filter: runFilter } : {}),
    };

    jobsChannel = sb
      .channel("jobs-live")
      .on(
        "postgres_changes",
        { event: "INSERT", ...baseFilter },
        handleJobChange,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", ...baseFilter },
        handleJobChange,
      )
      .subscribe();

    return () => {
      disposed = true;
      if (jobsChannel) sbChannelCleanup(jobsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, enabled]);

  // ── Hydrate effect: when a run is queued, seed status + load jobs ──
  useEffect(() => {
    if (!enabled || !runId) return;
    const id = runId; // narrow to string
    let cancelled = false;

    async function hydrate() {
      const sb = getSupabaseBrowser();

      // Seed run status + last_error from the pipeline_runs row
      const run = await getPipelineRunAction(id);
      if (!cancelled && run.ok && run.pipelineRun) {
        if (run.pipelineRun.status) {
          dispatch(runStatusUpdated(run.pipelineRun.status));
        }
        if (run.pipelineRun.last_error && run.pipelineRun.status === "failed") {
          dispatch(runError(run.pipelineRun.last_error));
        }
        if (run.pipelineRun.evaluation_status) {
          dispatch(evaluationStatusUpdated(run.pipelineRun.evaluation_status));
        }
      }

      // Seed per-keyword batch progress (evaluation_runs rows)
      const evalRuns = await getEvaluationRunsAction(id);
      if (!cancelled && evalRuns.ok) {
        dispatch(evaluationRunsUpdated(evalRuns.runs));
      }

      // Per-board breakdown via Express REST
      const detail = await statsRunDetailAction(id);
      if (!cancelled && detail.ok && detail.detail?.boards) {
        dispatch(runBoardsUpdated(detail.detail.boards));
      }

      // Load the current job stream for this run
      const { data, error } = await sb
        .from("jobs")
        .select(JOB_SELECT)
        .eq("pipeline_run_id", id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled && !error && data) {
        dispatch(runJobStreamReplaced(data as LiveJobRow[]));
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, enabled]);

  return { runId };
}

/** Remove + unsubscribe a Supabase channel. */
function sbChannelCleanup(
  channel: ReturnType<ReturnType<typeof getSupabaseBrowser>["channel"]>,
) {
  try {
    channel.unsubscribe();
  } catch {
    /* ignore */
  }
}
