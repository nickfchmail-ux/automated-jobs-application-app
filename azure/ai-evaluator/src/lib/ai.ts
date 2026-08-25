import type { JobEvaluationResult } from "../shared/types.js";

/**
 * Minimal OpenAI-compatible chat client — enough for one call per job post.
 * Provider-agnostic: point `DeepSeekBaseUrl` at any OpenAI-compatible endpoint
 * (DeepSeek, Azure OpenAI, Together, etc.).
 */

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | null };
  }[];
}

const RETRY_DELAYS_MS = [500, 1500, 4000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

/**
 * Retry a transient LLM failure (empty response, timeout, 5xx, rate-limit)
 * with backoff. Permanent failures (bad request, auth) fail fast.
 *
 * `maxRetries` can be lowered for long-running document generation — the
 * default 3 retries + Service Bus re-delivery backoff can turn a single
 * resume (which legitimately takes ~30-40s) into a 5-minute wait when it
 * times out. Resume/cover-letter generation uses 1 retry to fail fast and
 * let the user retry from the UI instead of silently waiting.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status =
        e && typeof e === "object" && "status" in e
          ? (e as { status?: number }).status
          : undefined;
      const msg = e instanceof Error ? e.message : String(e);
      // Permanent → don't retry.
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw e;
      }
      // Empty-response / timeout / 5xx / rate-limit → retry with backoff.
      if (
        /empty response|timed? ?out|abort|5\d\d|429|ECONNRESET|fetch failed/i.test(
          msg,
        )
      ) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Parse the model's reply for a SINGLE job evaluation.
 *
 * The model returns one JSON object (possibly wrapped in a `{ "job": ... }`
 * or `{ "jobs": [...] }` envelope — tolerate all shapes). Reuses the same
 * field coercion as the batch normalizer.
 */
export function parseSingleJobResult(text: string): JobEvaluationResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced ? fenced[1] : text).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("LLM returned no parseable JSON");
    }
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM result is not an object");
  }

  // Unwrap common envelopes: { job: {...} } or { jobs: [...] } or the bare object.
  const root = parsed as Record<string, unknown>;
  let record: Record<string, unknown> = root;
  const singleJob = root.job;
  if (typeof singleJob === "object" && singleJob !== null) {
    record = singleJob as Record<string, unknown>;
  } else if (Array.isArray(root.jobs) && root.jobs.length > 0) {
    const first: unknown = root.jobs[0];
    if (first && typeof first === "object") {
      record = first as Record<string, unknown>;
    }
  }

  const jobId =
    typeof record.jobId === "string"
      ? record.jobId
      : typeof record.id === "string"
        ? record.id
        : "";
  if (!jobId) {
    throw new Error("LLM result missing jobId");
  }

  const score = clampScore(Number(record.fit_score ?? record.score ?? 0));
  const fit =
    typeof record.fit === "boolean"
      ? record.fit
      : typeof record.fit === "string"
        ? record.fit === "true"
        : score >= 50;

  return {
    jobId,
    fit,
    fit_score: score,
    justification:
      typeof record.justification === "string" ? record.justification : null,
    fit_reasons: toStringArray(record.fit_reasons ?? record.reasons ?? []),
    not_fit_reasons: toStringArray(
      record.not_fit_reasons ?? record.notFitReasons ?? record.not_fit ?? [],
    ),
    cover_letter:
      typeof record.cover_letter === "string" ? record.cover_letter : null,
    expected_salary:
      typeof record.expected_salary === "string"
        ? record.expected_salary
        : null,
  };
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return toStringArray(parsed);
    } catch {
      /* not JSON — ignore */
    }
    return [value];
  }
  return [];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Whether to ask the model for strict JSON (`response_format: json_object`).
   * Default true (evaluation + resume need JSON). Set FALSE for the cover
   * letter so it returns clean plain text directly — faster, and there is no
   * JSON wrapper to unwrap (which could otherwise leak raw JSON if unwrap
   * failed).
   */
  jsonMode?: boolean;
}

/**
 * One grouped chat completion call for an entire keyword batch.
 * Returns the parsed `{ jobs: [...] }` result.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatCompletionResponse> {
  const baseUrl = (
    process.env["DeepSeekBaseUrl"] ||
    process.env["DEEP_SEEK_BASE_URL"] ||
    "https://api.deepseek.com/v1"
  ).replace(/\/+$/, "");
  const apiKey = process.env["DEEP_SEEK_API"] || process.env["DeepSeekApiKey"];
  if (!apiKey) throw new Error("DEEP_SEEK_API must be set");
  // IMPORTANT: use the FAST chat model `deepseek-chat`. Do NOT configure
  // `deepseek-v4-flash` — that is a REASONING variant that burns tokens
  // "thinking" before each answer (we saw reasoning_tokens + empty content +
  // slow generation for documents). `deepseek-chat` is the standard fast chat
  // model (the API serves the flash model under this id, WITHOUT reasoning
  // overhead).
  const model =
    process.env["DEEP_SEEK_MODEL"] ||
    process.env["DeepSeekModel"] ||
    "deepseek-chat";
  const timeoutMs = options.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4000,
        ...(options.jsonMode === false
          ? {}
          : { response_format: { type: "json_object" } }),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `LLM request failed (${res.status}): ${detail.slice(0, 300)}`,
      );
    }

    return (await res.json()) as ChatCompletionResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluate ONE job post with its own LLM call and parse the single result.
 *
 * Small response per call — immune to the output-token truncation that broke
 * large grouped batches. Callers consolidate the per-job results themselves.
 */
export async function evaluateSingleJobWithLLM(
  messages: ChatMessage[],
): Promise<JobEvaluationResult> {
  return withRetry(async () => {
    const completion = await chatCompletion(messages, {
      temperature: 0.2,
      maxTokens: 2000,
      timeoutMs: 60_000,
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned an empty response");
    return parseSingleJobResult(content);
  });
}

/** Generated tailored-resume payload returned by the LLM for a fit job. */
export interface ResumeDocumentResult {
  resumeHtml: string;
}

/**
 * Parse the model's reply for a single job's tailored resume.
 *
 * The resume HTML is a large document and can occasionally be TRUNCATED by
 * the model's output-token limit, producing invalid JSON ("Unterminated
 * string"). To be resilient we extract the `resumeHtml` field value with a
 * regex from the raw reply, so a truncated trailing string still yields a
 * usable resume. Falls back to strict JSON.parse when the reply is whole.
 */
export function parseResumeDocument(raw: string): ResumeDocumentResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced ? fenced[1] : raw).trim();

  // Try strict parse first (fast path when the reply is complete).
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const html = String(parsed?.resumeHtml ?? parsed?.resume_html ?? "");
    if (html) return { resumeHtml: html };
  } catch {
    /* fall through to salvage */
  }

  // Salvage: grab the "resumeHtml": "..." value even if JSON is truncated.
  // Handles escaped quotes inside the HTML by scanning for the closing quote.
  const m = jsonText.match(
    /["']resumeHtml["']\s*:\s*["']([\s\S]*?)["']\s*(?:,|\})?$/,
  );
  if (m && m[1]) {
    // Unescape common JSON escapes from the captured HTML.
    const html = m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    if (html) return { resumeHtml: html };
  }

  // Last resort: extract everything between the first <html and the end.
  const start = jsonText.indexOf("<html");
  if (start !== -1) {
    const html = jsonText
      .slice(start)
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"');
    if (html) return { resumeHtml: html };
  }

  throw new Error("LLM resume result missing resumeHtml");
}

/**
 * One LLM call to generate a TAILORED RESUME for a job.
 *
 * Independent of evaluation — called by the dedicated `resumeWorker` when the
 * user requests a tailored resume for a specific job. Grounded strictly in
 * the resume + job post.
 */
export async function generateResumeWithLLM(
  messages: ChatMessage[],
): Promise<ResumeDocumentResult> {
  // Resume HTML legitimately takes ~20-40s of LLM time. Give it a 120s
  // timeout (enough headroom) but only ONE retry — a second failure should
  // surface to the user quickly (Service Bus re-delivery backoff would
  // otherwise turn it into a multi-minute silent wait).
  return withRetry(async () => {
    const completion = await chatCompletion(messages, {
      temperature: 0.4,
      // Concise ~1-page resume with condensed projects = ~2000-2800 tokens of
      // HTML. Budgeting 3000 makes the model stop generating sooner → much
      // faster. The prompt also trims the job context + condenses projects.
      maxTokens: 3000,
      timeoutMs: 60_000,
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned an empty response");
    return parseResumeDocument(content);
  }, 1);
}

/**
 * One LLM call to generate a COVER LETTER for a job.
 *
 * Independent of evaluation — called by the dedicated `coverLetterWorker`
 * when the user requests a cover letter for a specific job. Returns the
 * letter as plain text (the frontend exports it to DOCX client-side).
 */
export async function generateCoverLetterWithLLM(
  messages: ChatMessage[],
): Promise<string> {
  // Short output — one retry max; fail fast rather than cascade retries.
  return withRetry(async () => {
    // Try PLAIN TEXT first (faster, no JSON wrapper to leak). DeepSeek can
    // occasionally return an empty content in plain-text mode with a large
    // full-context prompt, so fall back to JSON mode (very reliable) if so.
    // NOTE: pass `messages` AS-IS (it is an array). Do NOT spread it into an
    // object — `{ ...messages }` turns the array into `{0:…, 1:…}` which
    // DeepSeek rejects with a 400 "Failed to deserialize the JSON body".
    let content = await attemptCoverLetter(messages, false);
    if (!content) {
      content = await attemptCoverLetter(messages, true);
    }
    if (!content) throw new Error("LLM returned an empty response");

    // Defensive: unwrap a JSON envelope if the model wrapped it anyway.
    const trimmed = content.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const maybeJson = (fenced ? fenced[1] : trimmed).trim();
    if (maybeJson.startsWith("{")) {
      try {
        const parsed = JSON.parse(maybeJson) as Record<string, unknown>;
        const letter = parsed.cover_letter ?? parsed.letter ?? parsed.content;
        if (typeof letter === "string" && letter.trim()) return letter.trim();
      } catch {
        /* not JSON — fall through */
      }
    }
    return trimmed;
  }, 1);
}

/** One cover-letter LLM attempt. Returns the raw content (may be empty). */
async function attemptCoverLetter(
  messages: ChatMessage[],
  jsonMode: boolean,
): Promise<string | null> {
  const completion = await chatCompletion(messages, {
    temperature: 0.5,
    maxTokens: 2000,
    timeoutMs: 45_000,
    jsonMode,
  });
  return completion.choices?.[0]?.message?.content ?? null;
}
