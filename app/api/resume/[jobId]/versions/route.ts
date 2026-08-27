import { getUserId } from "@/lib/auth";
import { requireServiceClient } from "@/lib/supabase";
import type { DocumentVersion } from "@/types/api";
import { NextRequest, NextResponse } from "next/server";

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
  const supabase = requireServiceClient();

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
    if (isMissingTable(error)) {
      const legacy = await getLegacyResumeVersion(userId, jobId);
      if (legacy) return NextResponse.json({ versions: [legacy] });
      return NextResponse.json(
        { error: "No tailored resume found for this job." },
        { status: 404 },
      );
    }
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

  // Merge the LEGACY un-versioned resume (v1 original) if it exists AND a
  // document_versions row for v1 doesn't already. This keeps legacy jobs
  // (resume generated before the version feature) showing BOTH the original
  // v1 and any fine-tuned v2+ side by side.
  const hasV1 = versions.some((v) => v.version === 1);
  if (!hasV1) {
    const legacy = await getLegacyResumeVersion(userId, jobId);
    if (legacy) versions.unshift(legacy);
  }

  if (versions.length === 0) {
    return NextResponse.json(
      { error: "No tailored resume found for this job." },
      { status: 404 },
    );
  }

  return NextResponse.json({ versions });
}

/** The legacy un-versioned resume `<userId>-<jobId>.html` as a v1 nav entry. */
async function getLegacyResumeVersion(
  userId: string,
  jobId: string,
): Promise<{
  id: string;
  version: number;
  label: string;
  url: string;
  status: "building" | "completed" | "failed";
  refinement: string | null;
  basedOn: number | null;
  error: string | null;
} | null> {
  const supabase = requireServiceClient();
  const { data: row, error } = await supabase
    .from("generated_resumes")
    .select("file_name")
    .eq("job_id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row?.file_name) return null;
  // Only treat it as legacy v1 if the file is the un-versioned name.
  if (!row.file_name.endsWith(`${userId}-${jobId}.html`)) return null;
  return {
    id: "legacy",
    version: 1,
    label: "v1",
    url: `/api/resume/${jobId}`,
    status: "completed",
    refinement: null,
    basedOn: null,
    error: null,
  };
}

function isMissingTable(error: { message?: string; code?: string }): boolean {
  const msg = error?.message ?? "";
  return (
    error?.code === "42P01" ||
    /relation "public\.document_versions" does not exist/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}
