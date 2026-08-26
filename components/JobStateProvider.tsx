"use client";

import { getJobDocumentStateAction } from "@/app/actions/documents";
import { getRealtimeSession } from "@/app/actions/realtime";
import { getSupabaseBrowser, setSupabaseSession } from "@/lib/supabase-browser";
import type {
  CoverLetterStatus,
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
    };
  }
  return ctx;
}
