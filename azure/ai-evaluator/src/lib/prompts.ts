import type { JobForEvaluation } from "../shared/types.js";
import type { ChatMessage } from "./ai.js";

/**
 * Evaluation prompts.
 *
 * Each job post is evaluated with its OWN LLM call (see `buildSingleJobPrompt`),
 * then the results are consolidated by the batch worker. Scoring a single job
 * keeps every response small, so a large batch can no longer blow the model's
 * output-token limit (which happened with one grouped call per keyword).
 */

const SINGLE_JOB_SYSTEM_PROMPT = `You are an expert Hong Kong recruiting assistant. You evaluate ONE job posting against a candidate's resume and return a strict JSON object.

Return ONLY valid JSON with this exact shape — no markdown, no commentary:

{
  "jobId": "<the job's id, copied exactly from the input>",
  "fit": true,
  "fit_score": 78,
  "justification": "A short plain-language sentence explaining the score.",
  "fit_reasons": ["reason 1", "reason 2"],
  "not_fit_reasons": ["what's missing 1", "what's missing 2"],
  "cover_letter": "A short, professional 3-paragraph cover letter addressed to this specific role and company, or null if the job is a poor fit.",
  "expected_salary": "e.g. HKD 35k-45k per month, or null if unknown"
}

Rules:
- jobId MUST be copied exactly from the input — never modify it.
- fit_score is 0-100: 75+ = great fit, 50-74 = possible fit, below 50 = low fit.
- justification: one concise sentence explaining the score.
- fit_reasons: 2-4 concise, specific reasons grounded in the job description vs the resume.
- not_fit_reasons: 2-4 concise, specific reasons the candidate does NOT fit (missing skills, experience, seniority).
- cover_letter: only generate for fit === true. Use null for poor fits.
- TRUTHFULNESS: base every judgment ONLY on information present in the candidate resume. Never invent, assume, or embellish skills, employers, titles, dates, or metrics. If the resume lacks evidence for a requirement, say so in not_fit_reasons and score accordingly.
- Be honest — if the resume has no relevant experience, score low.`;

export function serializeJob(job: JobForEvaluation): string {
  return JSON.stringify({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    employment_type: job.employment_type,
    experience_level: job.experience_level,
    skills: job.skills,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    benefits: job.benefits,
    short_description: job.short_description,
    raw_description: (job.raw_description ?? "").slice(0, 6000),
  });
}

/**
 * Build the prompt for a SINGLE job evaluation.
 *
 * One LLM call per job post (per the team's design). The model returns one
 * JSON object (not an array) so the response stays small and can never be
 * truncated by the output-token limit.
 */
export function buildSingleJobPrompt(
  resumeText: string,
  job: JobForEvaluation,
): ChatMessage[] {
  return [
    { role: "system", content: SINGLE_JOB_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate resume:\n\n${resumeText}\n\n---\n\nEvaluate this ONE job posting against the candidate resume. Return exactly one JSON object.\n\nJob posting:\n\n${serializeJob(job)}`,
    },
  ];
}

/**
 * Tailored-resume prompt (fit jobs only).
 *
 * The cover letter is produced by the per-job evaluation call. This separate
 * call generates ONLY the tailored resume HTML, grounded strictly in the
 * sanitized resume + the job post — never inventing facts.
 */
const RESUME_SYSTEM_PROMPT = `You are an expert resume writer. Given a candidate's real resume and a specific job posting, produce a TAILORED resume (HTML) for that job.

Return ONLY valid JSON — no markdown, no commentary:

{
  "resumeHtml": "<a complete, self-contained HTML document (<html><body>...) of the tailored resume. Only include facts present in the candidate resume; never invent skills, employers, titles, dates, or metrics. Re-order and emphasize what's relevant to THIS job, keep it to one page, use inline CSS, and include the candidate's contact details from the resume.>"
}

Rules:
- TRUTHFULNESS: every fact in the resume must come from the candidate resume. Never fabricate.
- Tailor to THIS job: emphasize matching skills/experience, order sections by relevance.
- Professional and ready to send.`;

export function buildResumePrompt(
  resumeText: string,
  job: JobForEvaluation,
): ChatMessage[] {
  return [
    { role: "system", content: RESUME_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate resume (contact included):\n\n${resumeText}\n\n---\n\nJob posting:\n\n${serializeJob(job)}\n\nGenerate the tailored resume HTML JSON for this job.`,
    },
  ];
}
