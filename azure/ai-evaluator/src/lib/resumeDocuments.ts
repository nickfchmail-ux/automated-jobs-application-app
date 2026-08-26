import { getSupabase } from "./supabase.js";

/** Retry a transient storage/DB failure (timeout, connection reset). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [500, 1500, 4000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (
        /timed? ?out|connection|ECONNRESET|network|socket|fetch failed/i.test(
          msg,
        )
      ) {
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Persist a generated tailored resume for a fit job.
 *
 * Follows the platform's established storage contract (shared with the
 * scraper's resume pipeline, now disabled):
 *   - bucket:    `generated-resumes`
 *   - file:      `<userId>-<jobId>.html`
 *   - tracking:  `generated_resumes` row (user_id + job_id → resume_url)
 *   - mirror:    `jobs.resume_url` / `jobs.resume_status` for easy Realtime
 *
 * The bucket + RLS are created by migration
 * `0006_generated_resumes.sql` / `0008_resume_pdf.sql` (backend) and the
 * evaluator's own migrations.
 */
const GENERATED_BUCKET = "generated-resumes";

export async function storeGeneratedResume(params: {
  userId: string;
  jobId: string;
  html: string;
  /** Optional explicit version; defaults to max existing + 1. */
  version?: number;
}): Promise<{ resumeUrl: string | null; fileName: string }> {
  const { userId, jobId, html, version: requestedVersion } = params;
  const sb = getSupabase();
  const baseName = `${userId}-${jobId}`;

  return withRetry(async () => {
    // Determine the NEXT version number by listing existing files for this
    // job (e.g. <base>-v1.html, <base>-v2.html, …). Each generation is kept
    // as its own version so the user can flip between the original and the
    // fine-tuned resume (carousel/version nav in the overlay). The LEGACY
    // un-versioned file (`<base>.html`) counts as v1.
    let version = requestedVersion ?? 1;
    if (!requestedVersion) {
      try {
        const { data: files, error: listErr } = await sb.storage
          .from(GENERATED_BUCKET)
          .list("", { search: baseName });
        if (!listErr && files) {
          let maxV = 0;
          for (const f of files) {
            if (f.name === `${baseName}.html`) maxV = Math.max(maxV, 1);
            else if (f.name.startsWith(`${baseName}-v`)) {
              const m = f.name.match(/-v(\d+)\.html$/i);
              if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
            }
          }
          if (maxV) version = maxV + 1;
        }
      } catch {
        /* fall through — start at v1 */
      }
    }

    const fileName = `${baseName}-v${version}.html`;

    const { error: uploadErr } = await sb.storage
      .from(GENERATED_BUCKET)
      .upload(fileName, Buffer.from(html, "utf8"), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });
    if (uploadErr) {
      throw new Error(
        `Failed to upload generated resume: ${uploadErr.message}`,
      );
    }

    // Public URL so the frontend can open the resume directly.
    const { data } = sb.storage.from(GENERATED_BUCKET).getPublicUrl(fileName);
    const resumeUrl = data.publicUrl;

    // Tracking row so the frontend can retrieve the LATEST per job (Realtime).
    const { error: upsertErr } = await sb.from("generated_resumes").upsert(
      {
        user_id: userId,
        job_id: jobId,
        status: "completed",
        resume_url: resumeUrl,
        file_name: fileName,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,job_id" },
    );
    if (upsertErr) {
      throw new Error(
        `Failed to save generated_resumes row: ${upsertErr.message}`,
      );
    }

    return { resumeUrl, fileName };
  });
}
