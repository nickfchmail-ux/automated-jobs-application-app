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

const COVER_LETTER_BUCKET = "cover-letters";

/**
 * Persist a generated cover letter version for a job.
 *
 * Each generation is stored as its own versioned file
 * (`<userId>-<jobId>-v<N>.txt`) in the `cover-letters` bucket so the user can
 * flip between the original and each fine-tuned version. The LATEST is also
 * mirrored onto `jobs.cover_letter` (Realtime + socket surface it live).
 */
export async function storeCoverLetterVersion(params: {
  userId: string;
  jobId: string;
  letter: string;
  /** Optional explicit version; defaults to max existing + 1. */
  version?: number;
}): Promise<{ url: string | null; fileName: string }> {
  const { userId, jobId, letter, version: requestedVersion } = params;
  const sb = getSupabase();
  const baseName = `${userId}-${jobId}`;

  return withRetry(async () => {
    // Next version number by listing existing files for this job. The LEGACY
    // un-versioned file (`<base>.txt`) counts as v1.
    let version = requestedVersion ?? 1;
    if (!requestedVersion) {
      try {
        const { data: files, error: listErr } = await sb.storage
          .from(COVER_LETTER_BUCKET)
          .list("", { search: baseName });
        if (!listErr && files) {
          let maxV = 0;
          for (const f of files) {
            if (f.name === `${baseName}.txt`) maxV = Math.max(maxV, 1);
            else if (f.name.startsWith(`${baseName}-v`)) {
              const m = f.name.match(/-v(\d+)\.txt$/i);
              if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
            }
          }
          if (maxV) version = maxV + 1;
        }
      } catch {
        /* fall through — start at v1 */
      }
    }

    const fileName = `${baseName}-v${version}.txt`;
    const { error: uploadErr } = await sb.storage
      .from(COVER_LETTER_BUCKET)
      .upload(fileName, Buffer.from(letter, "utf8"), {
        contentType: "text/plain; charset=utf-8",
        upsert: true,
      });
    if (uploadErr) {
      // If the bucket doesn't exist yet, create it best-effort and retry once.
      const { error: createErr } = await sb.storage.createBucket(
        COVER_LETTER_BUCKET,
        { public: true },
      );
      if (createErr) {
        throw new Error(`Failed to upload cover letter: ${uploadErr.message}`);
      }
      const retry = await sb.storage
        .from(COVER_LETTER_BUCKET)
        .upload(fileName, Buffer.from(letter, "utf8"), {
          contentType: "text/plain; charset=utf-8",
          upsert: true,
        });
      if (retry.error) {
        throw new Error(
          `Failed to upload cover letter: ${retry.error.message}`,
        );
      }
    }

    const { data } = sb.storage
      .from(COVER_LETTER_BUCKET)
      .getPublicUrl(fileName);
    return { url: data.publicUrl, fileName };
  });
}
