import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { getSupabase } from "./supabase.js";

const BUCKET = "resume";

/**
 * Fetch the user's resume text for evaluation.
 *
 * The frontend uploads the user's resume to Supabase Storage under
 * `resume/<userId>-resume.<ext>`. The evaluator downloads it and extracts
 * text so the LLM has the candidate's profile to score against.
 */
export async function fetchResumeText(userId: string): Promise<string> {
  const sb = getSupabase();
  const { data: files, error } = await sb.storage.from(BUCKET).list("", {
    search: `${userId}-resume`,
  });
  if (error) {
    throw new Error(`Failed to list resume: ${error.message}`);
  }

  const match = files?.find((f) => f.name.startsWith(`${userId}-resume`));
  if (!match) {
    throw new Error(
      "No resume found for this user. Please upload a resume first.",
    );
  }

  const { data: blob, error: dlErr } = await sb.storage
    .from(BUCKET)
    .download(match.name);
  if (dlErr || !blob) {
    throw new Error(
      `Failed to download resume: ${dlErr?.message ?? "unknown"}`,
    );
  }

  return await extractText(blob, match.name);
}

async function extractText(blob: Blob, fileName: string): Promise<string> {
  const name = fileName.toLowerCase();
  const buf = Buffer.from(await blob.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const data = await pdfParse(buf);
    const text = data.text?.trim() ?? "";
    if (text.length >= 40) return text;
    throw new Error("Resume PDF contained no extractable text.");
  }

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = result.value?.trim() ?? "";
    if (text.length >= 40) return text;
    throw new Error("Resume DOCX contained no extractable text.");
  }

  // Plain text fallback (.txt / .doc-as-text)
  const text = buf.toString("utf8").trim();
  if (text.length >= 40) return text;
  throw new Error("Resume contained no readable text.");
}

/**
 * Sanitize resume text before it is sent to the LLM.
 *
 * Requirement: only TRUTHFUL, resume-derived facts reach the model, and
 * personal contact details (PII) are stripped — the AI never needs the user's
 * email, phone, address, IDs, or social links to score a job.
 *
 * - `includeContact: false` (evaluation): strip ALL contact/identity details.
 * - `includeContact: true`  (document generation): keep contact so the tailored
 *   resume/cover letter can include it, but still strip government IDs/DOB.
 *
 * Content (skills, employers, titles, dates, education, metrics) is preserved.
 */
export function sanitizeResume(
  text: string,
  opts: { includeContact?: boolean } = {},
): string {
  const { includeContact = false } = opts;
  let out = text;

  // Government / national IDs, HKID, passport, DOB — always strip.
  out = out.replace(
    /\b(?:HKID|ID|Passport|National ID|NRIC|SSN)\s*[:#]?\s*[A-Z0-9]{4,}\b/gi,
    "[redacted id]",
  );
  out = out.replace(/\b\d{6}[-–]?\d{3,4}\b/g, "[redacted id]"); // HKID pattern
  // DOB: only a REAL date (1-2 digit day, 1-2 digit month, 2-4 digit year),
  // e.g. 12/03/1990 — NOT a year range like 2020-2024 (employment dates must
  // be preserved for the truthful tailored resume).
  out = out.replace(
    /\b(?:born|DOB|Date of Birth)\s*:?[^,\n]*|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b(?!\s*[-–]\s*\d{4}\b)/gi,
    "[redacted dob]",
  );

  if (!includeContact) {
    // Email addresses.
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted email]");
    // Phone / fax numbers (incl. HK +852 prefix). Requires a phone-like
    // shape — never a pure "YYYY-YYYY" year range (employment dates must
    // survive for the truthful tailored resume). The lookahead at the start
    // rejects a leading 4-digit year immediately followed by "-" + 4 digits.
    out = out.replace(
      /(?<![\d-])(?!\d{4}[\s-]?\d{4}\b)(?:\+?\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,4})?(?!\d)/g,
      "[redacted phone]",
    );
    // Street addresses (loose: lines with "Road/Street/Ave/Lane/HK/Flat/Rm").
    out = out.replace(
      /(?:Flat|Rm|Room|Unit|Floor|Block|No\.?|G\/F|1\/F)\s*[^,\n]*/gi,
      "[redacted address]",
    );
    out = out.replace(
      /[^,\n]*\b(?:Road|Street|Street?|Avenue|Ave|Lane|Hong Kong)\b[^,\n]*/gi,
      "[redacted address]",
    );
    // Social / portfolio URLs (LinkedIn, GitHub, personal sites).
    out = out.replace(
      /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|angel\.co|[\w-]+\.(?:me|dev|portfolio|site))[^\s]*/gi,
      "[redacted link]",
    );
    // Any bare http(s) URLs.
    out = out.replace(/https?:\/\/[^\s]+/gi, "[redacted link]");
  }

  // Collapse repeated blank lines and trim.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
