import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";
import type { DocumentVersion } from "@/types/api";

/**
 * GET /api/jobs/[jobId]/cover-letter/versions
 *
 * Lists all generated cover-letter VERSIONS for a job (original + each
 * fine-tuned regeneration), scoped to the authenticated user. Reads the
 * authoritative `document_versions` table (each row carries status,
 * refinement and a file URL). Falls back to the latest inline
 * `jobs.cover_letter` (v1) if no versioned rows exist yet (legacy).
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
    .eq("doc_type", "cover-letter")
    .order("version", { ascending: true });

  if (error && !isMissingTable(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let versions = (rows as DocumentVersion[] | null)?.length
    ? ((rows as DocumentVersion[])
        .filter((r) => r.version >= 1)
        .map((r) => ({
          id: r.id,
          version: r.version,
          label: `v${r.version}`,
          url:
            r.url ?? `/api/jobs/${jobId}/cover-letter/versions/${r.version}`,
          status: r.status,
          refinement: r.refinement,
          basedOn: r.based_on,
          error: r.error,
        })) ?? [])
    : [];

  // No versioned rows yet — fall back to the latest inline letter (legacy).
  if (versions.length === 0) {
    const { data: job, error: jErr } = await supabase
      .from("jobs")
      .select("cover_letter")
      .eq("id", jobId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!jErr && job?.cover_letter) {
      versions = [
        {
          id: "legacy",
          version: 1,
          label: "v1",
          url: `/api/jobs/${jobId}/cover-letter/content`,
          status: "completed",
          refinement: null,
          basedOn: null,
          error: null,
        },
      ];
    }
  }

  if (versions.length === 0) {
    return NextResponse.json(
      { error: "No cover letter found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ versions });
}

function isMissingTable(error: { message?: string; code?: string }): boolean {
  const msg = error?.message ?? "";
  return (
    error?.code === "42P01" ||
    /relation "public\.document_versions" does not exist/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}
