import { getUserId } from "@/lib/auth";
import { requireServiceClient } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/resume/[jobId]
 *
 * Serves the AI-generated tailored resume HTML with the correct
 * `Content-Type: text/html` so the browser RENDERS it (Supabase Storage's
 * public URL serves `.html` files as `text/plain`, which makes the browser
 * show the raw HTML source instead of the styled resume).
 *
 * The file is resolved from `generated_resumes` and scoped to the
 * authenticated user — a user can only view their own tailored resumes.
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

  // Resolve the resume file for this job, scoped to the current user.
  const { data: row, error } = await supabase
    .from("generated_resumes")
    .select("file_name, resume_url")
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

  // Download the stored HTML from the generated-resumes bucket.
  const { data: blob, error: dlErr } = await supabase.storage
    .from("generated-resumes")
    .download(row.file_name);
  if (dlErr || !blob) {
    return NextResponse.json(
      { error: dlErr?.message ?? "Failed to load resume." },
      { status: 500 },
    );
  }

  const html = await blob.text();
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
