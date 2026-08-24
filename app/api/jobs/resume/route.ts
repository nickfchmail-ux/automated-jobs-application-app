import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/jobs/resume  { jobId }
 *
 * Signals the backend pipeline to generate a tailored resume for this job by
 * moving `jobs.resume_status` from none → ready_to_build. The backend watches
 * that transition and runs the generation (→ building → completed / failed),
 * writing back `resume_url` / `resume_pdf_url`. The client streams the status
 * and links via Supabase Realtime.
 */
export async function POST(req: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobId = body.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  // Ensure the job belongs to this user, then set ready_to_build
  const { data: existing, error: fetchErr } = await supabase
    .from("jobs")
    .select("id, resume_status")
    .eq("id", jobId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (existing.resume_status === "building") {
    return NextResponse.json(
      { error: "A resume is already being built." },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("jobs")
    .update({ resume_status: "ready_to_build" })
    .eq("id", jobId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId });
}
