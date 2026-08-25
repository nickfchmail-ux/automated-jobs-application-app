import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/resume/[jobId]/versions
 *
 * Lists all generated resume VERSIONS for a job (original + each fine-tuned
 * regeneration), scoped to the authenticated user. Each version is a file in
 * the `generated-resumes` bucket named `<userId>-<jobId>-v<N>.html`.
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
    .from("generated-resumes")
    .list("", { search: `${userId}-${jobId}` });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const versions = (files ?? [])
    .filter((f) => f.name.startsWith(prefix) && f.name.endsWith(".html"))
    .map((f) => {
      const m = f.name.match(/-v(\d+)\.html$/i);
      const n = m ? parseInt(m[1], 10) : 0;
      const { data } = supabase.storage
        .from("generated-resumes")
        .getPublicUrl(f.name);
      return { url: data.publicUrl, label: `v${n}`, version: n };
    })
    .sort((a, b) => a.version - b.version);

  return NextResponse.json({ versions });
}
