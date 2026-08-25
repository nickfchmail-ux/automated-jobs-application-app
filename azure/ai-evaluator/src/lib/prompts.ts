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
- not_fit_reasons: 2-4 concise, specific reasons the candidate does NOT fit. CRITICAL: each reason MUST be a GENUINE gap — something the job requires that the resume truly LACKS. NEVER list a skill or experience that is actually present in the resume. Before writing a "missing X" reason, first CHECK the resume: if the resume mentions X (as a skill, project, tool, or experience), X is NOT a valid not-fit reason. If the resume satisfies every requirement, return an empty not_fit_reasons array [] and score the fit accordingly.
- cover_letter: only generate for fit === true. Use null for poor fits.
- TRUTHFULNESS: base every judgment ONLY on information present in the candidate resume. Never invent, assume, or embellish skills, employers, titles, dates, or metrics. If the resume lacks evidence for a requirement, say so in not_fit_reasons and score accordingly.
- Be honest — if the resume has no relevant experience, score low.
- Example: if the job asks for Python/Django and the resume lists "Python, Django / REST Framework", do NOT write "no Python experience" — that would be a false reason. Only list true gaps (e.g. a required certification, specific seniority, a niche tool absent from the resume).`;

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
 * FULL job serialization for DOCUMENT GENERATION (cover letter + resume).
 *
 * Unlike `serializeJob` (used for fast evaluation scoring), this includes the
 * COMPLETE job content — the full raw description (no 6000-char truncation),
 * plus about_company, posted_date and url — so the cover-letter/resume AI
 * sees every detail of the role. A cover letter must be written against the
 * whole posting, not a truncated summary.
 */
export function serializeJobFull(job: JobForEvaluation): string {
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
    about_company: job.about_company,
    posted_date: job.posted_date,
    url: job.url,
    raw_description: job.raw_description ?? "",
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
  "resumeHtml": "<a complete, self-contained HTML document (<html><body>...) of the tailored resume. Include EVERY fact from the candidate resume — every skill, every role, every employer, every date range, every bullet point, every education entry, every certification, every project. NEVER omit, truncate, or summarize away any content. Re-order and emphasize what's relevant to THIS job, but KEEP ALL of it (the resume may span multiple pages — that is fine). Use inline CSS, and include the candidate's contact details from the resume.>"
}

Rules:
- TRUTHFULNESS: every fact in the resume must come from the candidate resume. Never fabricate.
- COMPLETENESS IS MANDATORY: do not drop any section, any role, any bullet, or any detail. If the candidate resume lists 4 jobs, list all 4. If a job has 6 bullets, include all 6.
- NO hyperlinks: render URLs (LinkedIn, GitHub, portfolio, email) as visible plain text — never <a> tags — because hyperlinks are invisible when printed as PDF.
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
      content: `Candidate resume (contact included) — PRESERVE ALL OF IT:\n\n${resumeText}\n\n---\n\nJob posting (FULL — read the entire description, responsibilities, requirements, benefits and company info):\n\n${serializeJobFull(job)}\n\nGenerate the tailored resume HTML JSON for this job.\n\nCRITICAL INSTRUCTIONS:\n- Include EVERY section and EVERY entry from the candidate resume: all skills, ALL work experience (every role, employer, date range, and all bullet points), ALL education, ALL certifications/courses, ALL projects. Do NOT omit, truncate, or drop any content.\n- Tailor the ORDERING and EMPHASIS to this job (put matching skills/experience first), but keep everything.\n- Use inline CSS, print-friendly (A4), and render any URLs (LinkedIn, GitHub, portfolio, email) as visible TEXT inside the resume — do NOT use hyperlinks (<a>), because links are invisible when the resume is printed as PDF.`,
    },
  ];
}

/**
 * Cover-letter prompt (independent generation).
 *
 * Used by the dedicated `coverLetterWorker` when the user asks for a cover
 * letter for a specific job. Grounded strictly in the resume + job post —
 * the letter never invents facts or contact details.
 */
const COVER_LETTER_SYSTEM_PROMPT = `You are an expert cover-letter writer. Given a candidate's real resume and a specific job posting, write a professional cover letter for that job.

Return the letter as PLAIN TEXT (paragraphs separated by blank lines) — no JSON, no markdown.

Rules:
- Address the role and company specifically. Reference 2-3 concrete points from the job posting that match the candidate's experience.
- Use the candidate's real contact details from the resume (name, email, phone) for the header and signature — never invent contact information.
- TRUTHFULNESS: every claim must come from the candidate resume. Never fabricate skills, employers, titles, dates, or metrics.
- Keep it concise: 3-4 short paragraphs, professional and warm.
- Sign off with the candidate's name from the resume.`;

export function buildCoverLetterPrompt(
  resumeText: string,
  job: JobForEvaluation,
): ChatMessage[] {
  return [
    { role: "system", content: COVER_LETTER_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate resume (contact included):\n\n${resumeText}\n\n---\n\nJob posting (FULL — read the entire description, responsibilities, requirements, benefits and company info):\n\n${serializeJobFull(job)}\n\nWrite a tailored cover letter for this exact role.`,
    },
  ];
}
