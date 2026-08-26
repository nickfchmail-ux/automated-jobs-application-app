import type { DocumentVersionRow } from "../shared/types.js";
import { getSupabase } from "./supabase.js";

/**
 * Per-version document state — the AUTHORITATIVE source for the fine-tune
 * version nav (replaces the storage-list hack the frontend used before).
 *
 * The evaluator owns the `document_versions` table (created by migration
 * `006_document_versions.sql`). The service-role key bypasses RLS, so every
 * query here is `.eq("user_id", userId)` — the same ownership boundary used
 * everywhere else in this service.
 *
 * Storage files (private buckets `generated-resumes` / `cover-letters`) keep
 * the actual content; this table tracks which versions exist, their status,
 * the refinement note that produced them, and where the file lives.
 */

export type DocType = "resume" | "cover-letter";

const BUCKETS: Record<DocType, string> = {
  resume: "generated-resumes",
  "cover-letter": "cover-letters",
};

const EXT: Record<DocType, string> = {
  resume: ".html",
  "cover-letter": ".txt",
};

/** The next version number for (user, job, type): max existing + 1. */
export async function nextDocumentVersion(
  userId: string,
  jobId: string,
  type: DocType,
): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("document_versions")
    .select("version")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("doc_type", type)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows; any other error is real but non-fatal — start at 1.
    throw new Error(`Failed to read document versions: ${error.message}`);
  }
  return data ? data.version + 1 : 1;
}

/** Build the versioned storage file name for a generation. */
export function documentFileName(
  userId: string,
  jobId: string,
  type: DocType,
  version: number,
): string {
  return `${userId}-${jobId}-v${version}${EXT[type]}`;
}

/**
 * Mark a version row `building` BEFORE the generation runs so a page refresh
 * mid-generation shows "Regenerating…" on the correct tab (durable state).
 * Inserts the row if this is the first time we see the version.
 */
export async function markDocumentVersionBuilding(params: {
  userId: string;
  jobId: string;
  type: DocType;
  version: number;
  refinement?: string;
  basedOn?: number;
}): Promise<void> {
  const { userId, jobId, type, version, refinement, basedOn } = params;
  const sb = getSupabase();
  const now = new Date().toISOString();

  const { error } = await sb.from("document_versions").upsert(
    {
      user_id: userId,
      job_id: jobId,
      doc_type: type,
      version,
      status: "building",
      refinement: refinement ?? null,
      based_on: basedOn ?? null,
      started_at: now,
      created_at: now,
    },
    {
      onConflict: "user_id,job_id,doc_type,version",
      ignoreDuplicates: false,
    },
  );
  if (error) {
    throw new Error(`Failed to mark version ${version} building: ${error.message}`);
  }
}

/**
 * Record a version as COMPLETED: the generated artifact is stored and the
 * version row carries its URL + file name. Called AFTER the storage upload
 * succeeds so the Realtime event always points at a real file.
 */
export async function markDocumentVersionCompleted(params: {
  userId: string;
  jobId: string;
  type: DocType;
  version: number;
  /** May be null if the storage URL couldn't be resolved — the versioned
   * content route still serves the file by name. */
  url: string | null;
  fileName: string;
}): Promise<void> {
  const { userId, jobId, type, version, url, fileName } = params;
  const sb = getSupabase();
  const now = new Date().toISOString();

  const { error } = await sb
    .from("document_versions")
    .update({
      status: "completed",
      url,
      file_name: fileName,
      error: null,
      completed_at: now,
    })
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("doc_type", type)
    .eq("version", version);
  if (error) {
    throw new Error(
      `Failed to mark version ${version} completed: ${error.message}`,
    );
  }
}

/** Record a version as FAILED (with the error surfaced to the overlay). */
export async function markDocumentVersionFailed(params: {
  userId: string;
  jobId: string;
  type: DocType;
  version: number;
  error: string;
}): Promise<void> {
  const { userId, jobId, type, version, error } = params;
  const sb = getSupabase();

  // Upsert so a failure on a version that was never marked building still
  // lands a row (e.g. enqueue failed on the first attempt).
  const { error: upsertErr } = await sb.from("document_versions").upsert(
    {
      user_id: userId,
      job_id: jobId,
      doc_type: type,
      version,
      status: "failed",
      error: error.slice(0, 500),
    },
    { onConflict: "user_id,job_id,doc_type,version" },
  );
  if (upsertErr) {
    throw new Error(
      `Failed to mark version ${version} failed: ${upsertErr.message}`,
    );
  }
}

/**
 * Load a specific version's CONTENT from the private storage bucket, scoped
 * to the owner. Returns null when the file is missing.
 */
export async function fetchDocumentVersionContent(params: {
  userId: string;
  jobId: string;
  type: DocType;
  version: number;
}): Promise<string | null> {
  const { userId, jobId, type, version } = params;
  const sb = getSupabase();
  const fileName = documentFileName(userId, jobId, type, version);
  try {
    const { data: blob, error } = await sb.storage
      .from(BUCKETS[type])
      .download(fileName);
    if (error || !blob) return null;
    return Buffer.from(await blob.arrayBuffer()).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Fetch the LATEST completed version's content for (user, job, type), so a
 * refinement pass can edit the most recent artifact instead of the original.
 */
export async function fetchLatestDocumentVersionContent(params: {
  userId: string;
  jobId: string;
  type: DocType;
}): Promise<string | null> {
  const { userId, jobId, type } = params;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("document_versions")
    .select("version")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("doc_type", type)
    .eq("status", "completed")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return fetchDocumentVersionContent({
    userId,
    jobId,
    type,
    version: data.version,
  });
}

/** All completed versions for (user, job, type) — for the worker to compute
 * `basedOn` and for the API to build the nav. */
export async function listDocumentVersions(params: {
  userId: string;
  jobId: string;
  type: DocType;
}): Promise<DocumentVersionRow[]> {
  const { userId, jobId, type } = params;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("document_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("doc_type", type)
    .order("version", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentVersionRow[];
}
