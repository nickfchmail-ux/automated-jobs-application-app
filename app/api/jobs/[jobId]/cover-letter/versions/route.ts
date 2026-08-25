import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/jobs/[jobId]/cover-letter/versions
 *
 * Returns the generated cover letter version(s) for a job, scoped to the
 * authenticated owner. The current implementation stores the cover letter
 * inline on the `jobs` row (latest wins), so this returns a single version
 * (v1). The overlay hides the version nav when there is only one.
 *
 * NOTE: multi-version cover letters are not stored yet — if you want to keep
 * each fine-tuned cover letter as a distinct version, the backend worker must
 * persist each generation (e.g. in storage like the resume does).
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

  const { data: job, error } = await supabase
    .from("jobs")
    .select("cover_letter, cover_letter_status")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job?.cover_letter) {
    return NextResponse.json({ error: "No cover letter found." }, { status: 404 });
  }

  // Single version — the content is returned via a dedicated fetch below.
  return NextResponse.json({
    versions: [
      {
        url: `/api/jobs/${jobId}/cover-letter/content`,
        label: "v1",
        version: 1,
      },
    ],
  });
}
