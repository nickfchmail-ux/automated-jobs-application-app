"use client";

import { getRealtimeSession } from "@/app/actions/realtime";
import { getSupabaseBrowser, setSupabaseSession } from "@/lib/supabase-browser";
import type { DocumentVersion } from "@/types/api";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

/** One entry in the version nav for a document type. */
export interface DocumentVersionNav {
  id: string;
  version: number;
  label: string;
  status: "building" | "completed" | "failed";
  url: string | null;
  refinement: string | null;
  basedOn: number | null;
  error: string | null;
}

function toNavVersion(v: DocumentVersion): DocumentVersionNav {
  return {
    id: v.id,
    version: v.version,
    label: `v${v.version}`,
    status: v.status,
    url: v.url,
    refinement: v.refinement,
    basedOn: v.based_on,
    error: v.error,
  };
}

/**
 * Live per-version document state for ONE doc type (resume | cover-letter),
 * driven by Supabase Realtime — NO polling, NO intervals.
 *
 *  1. Seeds once from the versions API on enable (includes the LEGACY v1 that
 *     has no `document_versions` row yet).
 *  2. Subscribes to Supabase Realtime on `document_versions`
 *     (INSERT/UPDATE/DELETE) filtered to this job + doc type.
 *
 * A fine-tune therefore streams in live: the new version's tab appears with a
 * spinner while `building`, then flips to `completed` the moment the worker
 * marks it — no manual refresh, no timer.
 */
export function useDocumentVersions(
  jobId: string,
  type: "resume" | "cover-letter",
  enabled = true,
): {
  versions: DocumentVersionNav[];
  loading: boolean;
  /** Manually re-fetch the versions list from the API. */
  refresh: () => Promise<void>;
} {
  const [versions, setVersions] = useState<DocumentVersionNav[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Fetch the versions list from the API (used on mount + manual refresh).
  const load = useCallback(async (): Promise<void> => {
    if (!enabled || !jobId) return;
    const listUrl =
      type === "resume"
        ? `/api/resume/${jobId}/versions`
        : `/api/jobs/${jobId}/cover-letter/versions`;
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      const list: DocumentVersionNav[] = Array.isArray(d?.versions)
        ? d.versions.map((v: Record<string, unknown>) => ({
            id: String(v.id),
            version: Number(v.version),
            label: String(v.label ?? `v${v.version}`),
            status: (v.status as DocumentVersionNav["status"]) ?? "completed",
            url: (v.url as string | null) ?? null,
            refinement: (v.refinement as string | null) ?? null,
            basedOn: (v.based_on as number | null) ?? null,
            error: (v.error as string | null) ?? null,
          }))
        : [];
      setVersions(list);
    } catch {
      // Transient — keep whatever we already have.
    } finally {
      setLoading(false);
    }
  }, [enabled, jobId, type]);

  // ── 1. Seed from the versions API once when enabled (no interval) ──
  useEffect(() => {
    if (!enabled || !jobId) return;
    setLoading(true);
    void load();
  }, [enabled, jobId, load]);

  // ── 2. Supabase Realtime on `document_versions` for this job ──────
  useEffect(() => {
    if (!enabled || !jobId) return;
    let disposed = false;

    async function listen() {
      const { token } = await getRealtimeSession();
      if (disposed || !token) return;
      setSupabaseSession(token);
      const sb = getSupabaseBrowser();

      const channel = sb
        .channel(`document-versions-${jobId}-${type}`)
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
            // Only this doc type's rows.
            if (!row || row.doc_type !== type) return;
            setVersions((prev) => {
              const idx = prev.findIndex((v) => v.version === row.version);
              if (payload.eventType === "DELETE") {
                if (idx === -1) return prev;
                const next = [...prev];
                next.splice(idx, 1);
                return next;
              }
              const updated = toNavVersion(row as DocumentVersion);
              if (idx === -1) {
                return [...prev, updated].sort((a, b) => a.version - b.version);
              }
              const next = [...prev];
              next[idx] = updated;
              return next;
            });
          },
        )
        .subscribe();
      channelRef.current = channel;
    }

    void listen();
    return () => {
      disposed = true;
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch {
          /* ignore */
        }
        channelRef.current = null;
      }
    };
  }, [jobId, type, enabled]);

  return { versions, loading, refresh: load };
}
