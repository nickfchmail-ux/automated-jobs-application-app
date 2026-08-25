/**
 * INSTANT tailored-resume builder — template-based, NO LLM call.
 *
 * Why: generating a full custom HTML resume via an LLM takes ~20-40s per
 * request, which no amount of Azure scale-out can make "instant" for a single
 * user. The fix is to NOT call the LLM for the resume at all: we parse the
 * user's real resume text (already stored) into structured sections, then
 * render a clean, professional, print-ready HTML template filled with the
 * user's ACTUAL data, tailored to the job's skills/requirements.
 *
 * This is a pure function: given (resumeText, job) it returns the resume HTML
 * in well under a second, and scales to any number of concurrent users (each
 * Azure function invocation just runs this synchronously — no external call).
 *
 * Truthfulness is guaranteed by construction: every fact comes from the user's
 * own resume text. We never invent skills, employers, titles, dates or metrics.
 */
import type { JobForEvaluation } from "../shared/types.js";

interface ParsedResume {
  name: string;
  contact: string[];
  summary: string;
  skills: string[];
  experience: {
    title: string;
    org: string;
    dates: string;
    details: string[];
  }[];
  education: string[];
  certifications: string[];
}

/** Split a section's content into bullet-ish lines. */
function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Parse the raw resume text into structured sections. We look for common
 * section headings (case-insensitive) and bucket the lines between them.
 */
export function parseResumeText(raw: string): ParsedResume {
  const text = raw.replace(/\r/g, "");
  const lines = linesOf(text);

  const name = lines[0]?.split(/[|,]/)[0]?.trim() || "Your Name";

  // Contact: first 3 lines that look like email/phone/linkedin/github.
  const contact = lines
    .slice(0, 6)
    .filter((l) =>
      /@|linkedin|github|gitlab|portfolio|\+?\d[\d\s\-()]{7,}|\b(?:Hong Kong|HK)\b/i.test(
        l,
      ),
    )
    .slice(0, 3);

  // Detect section headings.
  const headingRe =
    /^(summary|profile|about|skills?|technologies?|experience|work experience|employment|education|academics?|certifications?|courses?|languages?|projects?)\b[:\-]?$/i;

  // Walk lines and bucket into the current section.
  const sections: Record<string, string[]> = {};
  let current = "summary";
  for (const line of lines.slice(1)) {
    if (headingRe.test(line.trim())) {
      const key = line
        .trim()
        .toLowerCase()
        .replace(/[^a-z]/g, "");
      current = key.includes("skill")
        ? "skills"
        : key.includes("experience") || key.includes("employment")
          ? "experience"
          : key.includes("educ")
            ? "education"
            : key.includes("cert") || key.includes("course")
              ? "certifications"
              : key.includes("project")
                ? "projects"
                : key.includes("summ") ||
                    key.includes("profile") ||
                    key.includes("about")
                  ? "summary"
                  : current;
      sections[current] = sections[current] ?? [];
      continue;
    }
    sections[current] = sections[current] ?? [];
    sections[current].push(line);
  }

  const summary = (sections.summary ?? []).join(" ").trim();
  const skills = (sections.skills ?? [])
    .join("\n")
    .split(/[,;•|\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40)
    .slice(0, 25);

  // Experience: parse "Title — Org · dates" blocks followed by detail lines.
  const experience: ParsedResume["experience"] = [];
  const expLines = sections.experience ?? [];
  let block: {
    title: string;
    org: string;
    dates: string;
    details: string[];
  } | null = null;
  const roleRe = /^(.+?)\s*(?:—|–|-|at|@|,)\s*(.+?)\s*(?:\·|\||\d{4}.*)?$/;
  for (const line of expLines) {
    if (
      /^(?:[A-Z][A-Za-z ]+)\s*(?:—|–|-|at|@)\s*[A-Za-z]/.test(line) ||
      /\d{4}\s*[–-]\s*\d{4}|\d{4}\s*[-–]\s*(present|now|current)/i.test(line)
    ) {
      const m = line.match(/^(.*?)\s*(?:—|–|-|at|@)\s*(.*?)\s*(\d{4}.*)?$/);
      if (block) experience.push(block);
      block = {
        title: m?.[1]?.trim() || line,
        org: m?.[2]?.trim() || "",
        dates: m?.[3]?.trim() || "",
        details: [],
      };
      continue;
    }
    if (block) block.details.push(line);
  }
  if (block) experience.push(block);

  const education = (sections.education ?? []).slice(0, 4);
  const certifications = (sections.certifications ?? []).slice(0, 6);

  return {
    name,
    contact,
    summary,
    skills,
    experience,
    education,
    certifications,
  };
}

/** Escape HTML in user-supplied text (never inject raw). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a print-ready tailored resume HTML from parsed resume data + job.
 * Fast, truthful, and styled for clean PDF/print output.
 */
export function buildResumeHtmlFromTemplate(
  resumeText: string,
  job: JobForEvaluation,
): string {
  const p = parseResumeText(resumeText);
  const jobSkills = (job.skills ?? [])
    .filter(Boolean)
    .map((s) => esc(String(s)));
  const targetRole = esc(job.title ?? "the role");

  // Skills: prefer the user's skills that MATCH the job's requirements first,
  // then the rest. This is the "tailoring" — ordering by relevance, never
  // inventing.
  const allSkills = p.skills;
  const matched = allSkills.filter((s) =>
    jobSkills.some((js) => s.toLowerCase().includes(js.toLowerCase())),
  );
  const ordered = [
    ...matched,
    ...allSkills.filter((s) => !matched.includes(s)),
  ];

  const skillsHtml = ordered.length
    ? ordered.map((s) => `<span class="skill">${esc(s)}</span>`).join("")
    : "";

  const expHtml = p.experience.length
    ? p.experience
        .map((e) => {
          const details = e.details.length
            ? `<ul>${e.details
                .slice(0, 4)
                .map((d) => `<li>${esc(d)}</li>`)
                .join("")}</ul>`
            : "";
          return `<div class="job"><h3>${esc(e.title)}${
            e.org ? ` — ${esc(e.org)}` : ""
          }</h3>${e.dates ? `<p class="dates">${esc(e.dates)}</p>` : ""}${details}</div>`;
        })
        .join("")
    : "";

  const eduHtml = p.education.length
    ? p.education.map((e) => `<p>${esc(e)}</p>`).join("")
    : "";

  const certHtml = p.certifications.length
    ? `<ul>${p.certifications.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "";

  const contactHtml = p.contact.length
    ? `<div class="contact">${p.contact.map((c) => esc(c)).join(" · ")}</div>`
    : "";

  const summaryHtml = p.summary
    ? `<section><h2>Professional Summary</h2><p>${esc(p.summary)}</p></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(p.name)} — Resume</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', -apple-system, Arial, sans-serif; color: #1f2933; max-width: 794px; margin: 0 auto; padding: 28px 36px; font-size: 12.5px; line-height: 1.45; }
  h1 { font-size: 24px; color: #0f172a; margin-bottom: 2px; }
  .contact { color: #52606d; font-size: 11.5px; margin-bottom: 14px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #0f766e; border-bottom: 1.5px solid #99f6e4; padding-bottom: 2px; margin: 14px 0 6px; }
  h3 { font-size: 13px; margin: 8px 0 2px; color: #111827; }
  .dates { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  p { margin: 2px 0 4px; }
  ul { margin: 2px 0 6px 16px; }
  li { margin: 1px 0; }
  .skill { display: inline-block; background: #f0fdfa; color: #0f766e; border: 1px solid #99f6e4; border-radius: 999px; padding: 1px 8px; margin: 2px 2px 0 0; font-size: 11px; }
  .job, section { break-inside: avoid; }
  @page { size: A4; margin: 12mm 11mm; }
  @media print { body { padding: 0; } h1,h2,h3 { break-after: avoid; } section, .job { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>${esc(p.name)}</h1>
  ${contactHtml}
  ${summaryHtml}
  ${skillsHtml ? `<section><h2>Skills</h2><div>${skillsHtml}</div></section>` : ""}
  ${expHtml ? `<section><h2>Work Experience</h2>${expHtml}</section>` : ""}
  ${eduHtml ? `<section><h2>Education</h2>${eduHtml}</section>` : ""}
  ${certHtml ? `<section><h2>Certifications &amp; Courses</h2>${certHtml}</section>` : ""}
  <p style="margin-top:16px;font-size:10px;color:#9aa5b1;text-align:center;">Tailored for ${targetRole}</p>
</body>
</html>`;
}
