import test from "node:test";
import assert from "node:assert/strict";
import { buildSingleJobPrompt, buildResumePrompt } from "../src/lib/prompts.js";
import type { JobForEvaluation } from "../src/shared/types.js";

const JOB: JobForEvaluation = {
  id: "job-1",
  title: "Senior React Engineer",
  company: "Acme Corp",
  location: "Hong Kong",
  salary: "HKD 50k",
  raw_description: "React, TypeScript, Azure",
  short_description: "Build a job platform",
  responsibilities: ["Own frontend", "Mentor juniors"],
  requirements: ["React", "TypeScript", "8 years"],
  benefits: ["Medical", "Bonus"],
  skills: ["React", "TypeScript"],
  employment_type: "Full-time",
  experience_level: "Senior",
  search_key: "react_engineer",
  user_id: "user-1",
  pipeline_run_id: "run-1",
  url: "https://example.com/job",
  status: "completed",
};

test("buildSingleJobPrompt: asks for strict JSON with jobId + conditional cover letter", () => {
  const [sys, user] = buildSingleJobPrompt("resume text", JOB);
  assert.match(sys.content, /Return ONLY valid JSON/);
  assert.match(sys.content, /"jobId"/);
  assert.match(sys.content, /cover_letter/);
  assert.match(sys.content, /only generate for fit === true/);
  assert.ok(user.content.includes(JOB.id));
  assert.ok(user.content.includes("Senior React Engineer"));
});

test("buildSingleJobPrompt: includes resume + job fields, trims raw_description", () => {
  const [, user] = buildSingleJobPrompt("candidate resume", JOB);
  assert.ok(user.content.includes("candidate resume"));
  assert.ok(user.content.includes("Acme Corp"));
  assert.ok(user.content.includes("React"));
});

test("buildResumePrompt: asks for resumeHtml only (documents)", () => {
  const [sys, user] = buildResumePrompt("resume text", JOB);
  assert.match(sys.content, /"resumeHtml"/);
  assert.ok(!/"coverLetter"/.test(sys.content));
  assert.ok(user.content.includes(JOB.id));
});

test("buildSingleJobPrompt: job with null fields still serializes", () => {
  const sparse: JobForEvaluation = {
    ...JOB,
    raw_description: null,
    responsibilities: null,
    requirements: null,
    benefits: null,
    skills: null,
    salary: null,
    location: null,
  };
  const [, user] = buildSingleJobPrompt("r", sparse);
  assert.ok(user.content.includes(sparse.id));
});
