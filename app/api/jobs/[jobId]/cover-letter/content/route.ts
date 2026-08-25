import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/jobs/[jobId]/cover-letter/content
 *
 * Returns the generated cover letter as plain text (scoped to the owner) —
 * used by DocumentPreviewOverlay to render the cover-letter tab.
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
    .select("cover_letter")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job?.cover_letter) {
    return NextResponse.json(
      { error: "No cover letter found." },
      { status: 404 },
    );
  }

  return new NextResponse(String(job.cover_letter), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
