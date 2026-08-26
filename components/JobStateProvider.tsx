"use client";

import { getJobDocumentStateAction } from "@/app/actions/documents";
import { getRealtimeSession } from "@/app/actions/realtime";
import { getSupabaseBrowser, setSupabaseSession } from "@/lib/supabase-browser";
import type {
  CoverLetterStatus,
  DocumentVersion,
  ResumeStatus,
  SocketJobStateEvent,
} from "@/types/api";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, Socket } from "socket.io-client";

/** The live state of ONE job, shared by every card on the detail page. */
export interface JobLiveState {
  resumeStatus: ResumeStatus | null;
  resumeUrl: string | null;
  coverLetterStatus: CoverLetterStatus | null;
  coverLetter: string | null;
  fit: boolean | null;
  fitScore: number | null;
  error: string | null;
  /** Per-version document state (fine-tune) — version nav source of truth. */
  documentVersions: DocumentVersion[];
}

const JobStateContext = createContext<JobLiveState | null>(null);

/**
 * Opens ONE socket.io connection + ONE Supabase Realtime channel for a job
 * and shares the live state with every consumer on the page (fit, resume,
 * cover letter). Without this, each card would open its own connection —
 * 3 sockets + 3 channels per job detail page.
 *
 * `initialState` is the server-rendered job row (passed from the layout), so
 * there is ZERO flash on first paint — the cards show the real resume/cover/
 * fit state immediately, then Realtime + socket keep it live.
 *
 * State sources (in order of authority):
 *  1. Server-provided `initialState` (first paint, no flash).
 *  2. Server-action hydrate (`getJobDocumentStateAction`) — survives refresh
 *     mid-generation (status lives in Supabase).
 *  3. Supabase Realtime on the `jobs` row (RLS-scoped) — live updates.
 *  4. Socket `job:state` — pushed by the backend when a document completes.
 */
export default function JobStateProvider({
  jobId,
  initialState,
  children,
}: PropsWithChildren<{
  jobId: string;
  initialState?: Partial<JobLiveState> | null;
}>) {
  const [state, setState] = useState<JobLiveState>({
    resumeStatus: initialState?.resumeStatus ?? null,
    resumeUrl: initialState?.resumeUrl ?? null,
    coverLetterStatus: initialState?.coverLetterStatus ?? null,
    coverLetter: initialState?.coverLetter ?? null,
    fit: initialState?.fit ?? null,
    fitScore: initialState?.fitScore ?? null,
    error: null,
    documentVersions: [],
  });

  const socketRef = useRef<Socket | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let disposed = false;

    const patch = (p: Partial<JobLiveState>) =>
      setState((prev) => ({ ...prev, ...p }));

    // 1. Hydrate from the DB immediately (survives refresh mid-generation).
    //    Fit + document state all come from the same row so the page is
    //    consistent on first paint and after a refresh.
    void getJobDocumentStateAction(jobId).then((res) => {
      if (disposed) return;
      if (res.ok) {
        patch({
          fit: res.state.fit,
          fitScore: res.state.fit_score,
          resumeStatus: res.state.resume_status,
          resumeUrl: res.state.resume_url,
          coverLetterStatus: res.state.cover_letter_status,
          coverLetter: res.state.cover_letter,
          documentVersions: res.state.document_versions,
        });
      } else {
        patch({ error: res.error });
      }
    });

    async function listen() {
      const { token, wsUrl } = await getRealtimeSession();
      if (disposed) return;
      if (!token) return; // no session → Realtime + socket stay inert

      setSupabaseSession(token);
      const sb = getSupabaseBrowser();

      // 2. Supabase Realtime on this job row (RLS-scoped to the owner).
      const channel = sb
        .channel(`job-state-${jobId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "jobs",
            filter: `id=eq.${jobId}`,
          },
          (payload) => {
            const row = payload.new as {
              fit?: boolean | null;
              fit_score?: number | null;
              resume_status?: string | null;
              resume_url?: string | null;
              cover_letter_status?: string | null;
              cover_letter?: string | null;
            };
            patch({
              fit: row.fit !== undefined ? row.fit : undefined,
              fitScore: row.fit_score !== undefined ? row.fit_score : undefined,
              resumeStatus:
                row.resume_status !== undefined
                  ? (row.resume_status as ResumeStatus)
                  : undefined,
              resumeUrl:
                row.resume_url !== undefined ? row.resume_url : undefined,
              coverLetterStatus:
                row.cover_letter_status !== undefined
                  ? (row.cover_letter_status as CoverLetterStatus)
                  : undefined,
              coverLetter:
                row.cover_letter !== undefined ? row.cover_letter : undefined,
            });
          },
        )
        // Fine-tune per-version state: INSERT/UPDATE/DELETE on
        // document_versions for this job streams straight into the overlay's
        // version nav (building → completed/failed, new version appears).
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "document_versions",
            filter: `job_id=eq.${jobId}`,
          },
          (payload) => {
            const row =
              payload.eventType === "DELETE"
                ? payload.old
                : (payload.new as Partial<DocumentVersion> | null);
            if (!row) return;
            setState((prev) => {
              const existing = prev.documentVersions ?? [];
              const idx = existing.findIndex(
                (v) => v.doc_type === row.doc_type && v.version === row.version,
              );
              if (payload.eventType === "DELETE") {
                if (idx === -1) return prev;
                const next = [...existing];
                next.splice(idx, 1);
                return { ...prev, documentVersions: next };
              }
              const updated = row as DocumentVersion;
              if (idx === -1) {
                return {
                  ...prev,
                  documentVersions: [...existing, updated].sort(
                    (a, b) => a.version - b.version,
                  ),
                };
              }
              const next = [...existing];
              next[idx] = updated;
              return { ...prev, documentVersions: next };
            });
          },
        )
        .subscribe();
      channelRef.current = channel;

      // 3. Socket `job:state` — instant push when a document completes.
      if (wsUrl && token) {
        const socket = io(wsUrl, {
          auth: { token },
          transports: ["websocket"],
          reconnectionAttempts: 5,
        });
        socketRef.current = socket;
        socket.on("job:state", (data: SocketJobStateEvent) => {
          if (!data?.ok || data.jobId !== jobId) return;
          patch({
            fit: data.fit,
            fitScore: data.fit_score,
            resumeStatus: data.resume_status,
            resumeUrl: data.resume_url,
            coverLetterStatus: data.cover_letter_status,
            coverLetter: data.cover_letter,
          });
        });
      }
    }
    void listen();

    return () => {
      disposed = true;
      if (socketRef.current) {
        try {
          socketRef.current.disconnect();
        } catch {
          /* ignore */
        }
        socketRef.current = null;
      }
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch {
          /* ignore */
        }
        channelRef.current = null;
      }
    };
  }, [jobId]);

  // ── Polling fallback ──────────────────────────────────────────────
  // Realtime + socket are the primary live sources, but if either silently
  // fails to deliver (stale channel, dropped socket), a building document
  // would stay stuck on "Generating… / Regenerating…" forever. Poll the DB
  // while a document is `building` so the status ALWAYS resolves to
  // completed/failed — this is the touchpoint that breaks any stale loop.
  const needsPoll =
    state.resumeStatus === "building" ||
    state.coverLetterStatus === "building" ||
    state.documentVersions.some((v) => v.status === "building");
  useEffect(() => {
    if (!needsPoll || !jobId) return;
    let disposed = false;
    async function poll() {
      if (disposed) return;
      const res = await getJobDocumentStateAction(jobId);
      if (disposed || !res.ok) return;
      setState((prev) => {
        const next = { ...prev };
        if (res.state.resume_status !== undefined)
          next.resumeStatus = res.state.resume_status;
        if (res.state.resume_url !== undefined)
          next.resumeUrl = res.state.resume_url;
        if (res.state.cover_letter_status !== undefined)
          next.coverLetterStatus = res.state.cover_letter_status;
        if (res.state.cover_letter !== undefined)
          next.coverLetter = res.state.cover_letter;
        if (res.state.document_versions?.length)
          next.documentVersions = res.state.document_versions;
        return next;
      });
    }
    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [needsPoll, jobId]);

  const value = useMemo(() => state, [state]);

  return (
    <JobStateContext.Provider value={value}>
      {children}
    </JobStateContext.Provider>
  );
}

/** Read the shared live state for the job detail page. */
export function useJobState(): JobLiveState {
  const ctx = useContext(JobStateContext);
  if (!ctx) {
    // Defensive: if a card is rendered without the provider, return inert
    // defaults (the card shows the "not started" state, not a crash).
    return {
      resumeStatus: null,
      resumeUrl: null,
      coverLetterStatus: null,
      coverLetter: null,
      fit: null,
      fitScore: null,
      error: null,
      documentVersions: [],
    };
  }
  return ctx;
}
