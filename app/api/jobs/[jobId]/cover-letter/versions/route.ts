import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/jobs/[jobId]/cover-letter/versions
 *
 * Lists all generated cover-letter VERSIONS for a job (original + each
 * fine-tuned regeneration), scoped to the authenticated user. Each version is
 * a file in the `cover-letters` bucket named `<userId>-<jobId>-v<N>.txt`.
 * Falls back to the latest inline `jobs.cover_letter` (v1) if no versioned
 * files exist yet (legacy generations).
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

  const prefix = `${userId}-${jobId}-v`;
  const { data: files, error } = await supabase.storage
    .from("cover-letters")
    .list("", { search: `${userId}-${jobId}` });

  if (
    error &&
    (error as { message?: string }).message !== "Bucket not found"
  ) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let versions = (files ?? [])
    .filter((f) => f.name.startsWith(prefix) && f.name.endsWith(".txt"))
    .map((f) => {
      const m = f.name.match(/-v(\d+)\.txt$/i);
      const n = m ? parseInt(m[1], 10) : 0;
      const { data } = supabase.storage
        .from("cover-letters")
        .getPublicUrl(f.name);
      return { url: data.publicUrl, label: `v${n}`, version: n };
    })
    .sort((a, b) => a.version - b.version);

  // No versioned files yet — fall back to the latest inline letter (legacy).
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
          url: `/api/jobs/${jobId}/cover-letter/content`,
          label: "v1",
          version: 1,
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
