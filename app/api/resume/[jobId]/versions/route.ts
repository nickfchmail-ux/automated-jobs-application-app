import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import type { DocumentVersion } from "@/types/api";

/**
 * GET /api/resume/[jobId]/versions
 *
 * Lists all generated resume VERSIONS for a job (original + each fine-tuned
 * regeneration), scoped to the authenticated user. Reads the authoritative
 * `document_versions` table (each version row carries status, refinement and
 * a file URL) — NOT a storage-list hack. Falls back to the un-versioned
 * legacy resume (from `generated_resumes`) when no versioned rows exist yet.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const { data: rows, error } = await supabase
    .from("document_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("doc_type", "resume")
    .order("version", { ascending: true });

  if (error) {
    // Table may not exist yet (migration not applied) → fall back to legacy.
    if (isMissingTable(error)) return legacyVersions(userId, jobId);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const versions = (rows as DocumentVersion[])
    .filter((r) => r.version >= 1)
    .map((r) => ({
      id: r.id,
      version: r.version,
      label: `v${r.version}`,
      url: r.url ?? `/api/resume/${jobId}/versions/${r.version}`,
      status: r.status,
      refinement: r.refinement,
      basedOn: r.based_on,
      error: r.error,
    }));

  // No versioned rows yet — fall back to the legacy (un-versioned) resume so
  // existing generated resumes stay viewable after the migration.
  if (versions.length === 0) {
    const legacy = await legacyVersions(userId, jobId);
    if (legacy.status !== 404) return legacy;
  }

  return NextResponse.json({ versions });
}

/** Legacy fallback — the un-versioned `<userId>-<jobId>.html` (v1 original). */
async function legacyVersions(userId: string, jobId: string) {
  const { data: row, error } = await supabase
    .from("generated_resumes")
    .select("file_name")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row?.file_name) {
    return NextResponse.json(
      { error: "No tailored resume found for this job." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    versions: [
      {
        id: "legacy",
        version: 1,
        label: "v1",
        url: `/api/resume/${jobId}`,
        status: "completed",
        refinement: null,
        basedOn: null,
        error: null,
      },
    ],
  });
}

function isMissingTable(error: { message?: string; code?: string }): boolean {
  const msg = error?.message ?? "";
  return (
    error?.code === "42P01" ||
    /relation "public\.document_versions" does not exist/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}
