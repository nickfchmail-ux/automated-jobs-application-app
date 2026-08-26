import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/jobs/[jobId]/cover-letter/versions/[version]
 *
 * Serves ONE specific version of the cover letter as plain text (v1, v2, …),
 * scoped to the authenticated owner. Reads the version's `file_name` from the
 * authoritative `document_versions` table and downloads it from the private
 * `cover-letters` bucket.
 */
export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ jobId: string; version: string }>;
  },
) {
  const { jobId, version: versionStr } = await params;
  const version = parseInt(versionStr, 10);
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!jobId || Number.isNaN(version) || version < 1) {
    return NextResponse.json(
      { error: "jobId and a valid version are required" },
      { status: 400 },
    );
  }

  const { data: row, error } = await supabase
    .from("document_versions")
    .select("file_name, status")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("doc_type", "cover-letter")
    .eq("version", version)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "This cover-letter version was not found." },
      { status: 404 },
    );
  }
  if (row.status === "building") {
    return NextResponse.json(
      { error: "This version is still generating." },
      { status: 409 },
    );
  }
  if (row.status === "failed") {
    return NextResponse.json(
      { error: "This version failed to generate." },
      { status: 422 },
    );
  }
  if (!row.file_name) {
    return NextResponse.json(
      { error: "No file for this cover-letter version." },
      { status: 404 },
    );
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from("cover-letters")
    .download(row.file_name);
  if (dlErr || !blob) {
    return NextResponse.json(
      { error: dlErr?.message ?? "Failed to load this version." },
      { status: 500 },
    );
  }

  const text = await blob.text();
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
