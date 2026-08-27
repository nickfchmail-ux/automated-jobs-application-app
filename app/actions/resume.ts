"use server";

import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const BUCKET = "resume";

export async function getResumeInfo(): Promise<
  | {
      ok: true;
      userId: string;
      fileName: string | null;
      signedUrl: string | null;
    }
  | { ok: false; error: string }
> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  // The resume filename is DETERMINISTIC (`${userId}-resume.${ext}`), so we
  // don't know the extension without listing. To avoid a bucket LIST on every
  // call (a storage-op cost on every profile render), probe the three allowed
  // extensions directly instead — each probe is a cheap HEAD against a known
  // path, not a full bucket scan.
  const candidates = ["pdf", "doc", "docx"].map(
    (ext) => `${userId}-resume.${ext}`,
  );

  // Try to find the existing file without a full bucket listing.
  let match: { name: string } | null = null;
  for (const name of candidates) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(name, 60 * 60);
    if (!error && data?.signedUrl) {
      // A signed URL existing means the object exists — use it directly.
      return {
        ok: true,
        userId,
        fileName: name,
        signedUrl: data.signedUrl,
      };
    }
  }

  // Fallback: no file found via direct probes — do a scoped LIST to confirm
  // (covers unusual extensions / legacy names). Only reached when the user
  // has no resume yet, so it's rare.
  const { data: files, error } = await supabase.storage.from(BUCKET).list("", {
    search: `${userId}-resume`,
  });

  if (error) return { ok: false, error: error.message };

  match = files?.find((f) => f.name.startsWith(`${userId}-resume`)) ?? null;

  if (!match) {
    return { ok: true, userId, fileName: null, signedUrl: null };
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(match.name, 60 * 60); // 1h

  if (signErr || !signed) {
    return { ok: true, userId, fileName: match.name, signedUrl: null };
  }

  return {
    ok: true,
    userId,
    fileName: match.name,
    signedUrl: signed.signedUrl,
  };
}

export type UploadResumeResult = { ok: true } | { ok: false; error: string };

export async function uploadResumeAction(
  formData: FormData,
): Promise<UploadResumeResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const file = formData.get("resume") as File | null;
  if (!file || file.size === 0)
    return { ok: false, error: "No file selected." };

  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (!allowedTypes.includes(file.type)) {
    return { ok: false, error: "Only PDF, DOC, or DOCX files are allowed." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const newName = `${userId}-resume.${ext}`;

  // Delete any existing resume for this user first (handles extension changes)
  const { data: existing } = await supabase.storage.from(BUCKET).list("", {
    search: `${userId}-resume`,
  });
  const old = existing?.find((f) => f.name.startsWith(`${userId}-resume`));
  if (old && old.name !== newName) {
    await supabase.storage.from(BUCKET).remove([old.name]);
  }

  // ── Skip re-upload when the file is unchanged ──────────────────────
  // If the existing file has the same name AND a known matching size, the
  // content is (almost certainly) identical — don't pay the storage write
  // again. This avoids re-uploading the resume on every save click. The
  // `list()` response's `metadata.size` is only sometimes populated; when
  // it's absent we fall through and upload (safe default).
  const knownSize = (old as { metadata?: Record<string, unknown> } | undefined)
    ?.metadata?.size;
  if (
    old?.name === newName &&
    typeof knownSize === "number" &&
    knownSize === file.size
  ) {
    return { ok: true };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(newName, buffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr) return { ok: false, error: uploadErr.message };

  return { ok: true };
}
