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
  const model =
    process.env["DEEP_SEEK_MODEL"] ||
    process.env["DeepSeekModel"] ||
    "deepseek-chat"; // DeepSeek V4 Flash (latest chat model)
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
        response_format: { type: "json_object" },
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
  const completion = await chatCompletion(messages, {
    temperature: 0.2,
    maxTokens: 2000,
  });
  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  return parseSingleJobResult(content);
}

/** Generated tailored-resume payload returned by the LLM for a fit job. */
export interface ResumeDocumentResult {
  resumeHtml: string;
}

/** Parse the model's reply for a single job's tailored resume. */
export function parseResumeDocument(raw: string): ResumeDocumentResult {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenced ? fenced[1] : raw).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("LLM returned no parseable JSON for the resume");
    }
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM resume result is not an object");
  }
  const r = parsed as Record<string, unknown>;
  const resumeHtml =
    typeof r.resumeHtml === "string" || typeof r.resume_html === "string"
      ? String(r.resumeHtml ?? r.resume_html)
      : "";
  if (!resumeHtml) {
    throw new Error("LLM resume result missing resumeHtml");
  }
  return { resumeHtml };
}

/**
 * One LLM call to generate a TAILORED RESUME for a fit job.
 *
 * The cover letter is produced in the SAME per-job evaluation call (fit →
 * both resume + cover letter; not-fit → neither). This second call only adds
 * the tailored resume HTML, grounded strictly in the resume + job post.
 */
export async function generateResumeWithLLM(
  messages: ChatMessage[],
): Promise<ResumeDocumentResult> {
  const completion = await chatCompletion(messages, {
    temperature: 0.4,
    maxTokens: 5000,
  });
  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned an empty response");
  return parseResumeDocument(content);
}
