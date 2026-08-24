import assert from "node:assert/strict";
import test from "node:test";
import { parseResumeDocument, parseSingleJobResult } from "../src/lib/ai.js";

test("parseSingleJobResult: parses a valid fit result", () => {
  const raw = JSON.stringify({
    jobId: "job-123",
    fit: true,
    fit_score: 82,
    justification: "Strong match on React and TypeScript.",
    fit_reasons: ["React", "TypeScript", "5 years exp"],
    not_fit_reasons: [],
    cover_letter: "Dear Hiring Manager...",
    expected_salary: "HKD 40k-50k",
  });
  const r = parseSingleJobResult(raw);
  assert.equal(r.jobId, "job-123");
  assert.equal(r.fit, true);
  assert.equal(r.fit_score, 82);
  assert.deepEqual(r.fit_reasons, ["React", "TypeScript", "5 years exp"]);
  assert.equal(r.cover_letter, "Dear Hiring Manager...");
  assert.equal(r.expected_salary, "HKD 40k-50k");
});

test("parseSingleJobResult: not-fit → cover_letter null, fit derived from score", () => {
  const raw = JSON.stringify({
    id: "job-456",
    score: 30,
    reasons: ["no relevant experience"],
    cover_letter: null,
  });
  const r = parseSingleJobResult(raw);
  assert.equal(r.jobId, "job-456");
  assert.equal(r.fit, false);
  assert.equal(r.fit_score, 30);
  assert.equal(r.cover_letter, null);
});

test("parseSingleJobResult: tolerates markdown code fences", () => {
  const raw =
    "```json\n" + JSON.stringify({ jobId: "j1", fit_score: 90 }) + "\n```";
  const r = parseSingleJobResult(raw);
  assert.equal(r.fit_score, 90);
});

test("parseSingleJobResult: tolerates { job: {...} } envelope", () => {
  const raw = JSON.stringify({ job: { jobId: "j7", fit_score: 64 } });
  const r = parseSingleJobResult(raw);
  assert.equal(r.jobId, "j7");
  assert.equal(r.fit_score, 64);
});

test("parseSingleJobResult: clamps score to 0-100", () => {
  const raw = JSON.stringify({ jobId: "j", fit_score: 250 });
  assert.equal(parseSingleJobResult(raw).fit_score, 100);
  const low = JSON.stringify({ jobId: "j", fit_score: -5 });
  assert.equal(parseSingleJobResult(low).fit_score, 0);
});

test("parseSingleJobResult: throws on missing jobId", () => {
  assert.throws(() => parseSingleJobResult('{"fit": true}'), /missing jobId/);
});

test("parseSingleJobResult: throws on unparseable JSON", () => {
  assert.throws(
    () => parseSingleJobResult("not json at all"),
    /no parseable JSON|is not an object/,
  );
});

test("parseResumeDocument: parses resumeHtml", () => {
  const r = parseResumeDocument(
    JSON.stringify({ resumeHtml: "<html><body>My resume</body></html>" }),
  );
  assert.match(r.resumeHtml, /<html>/);
});

test("parseResumeDocument: throws when resumeHtml missing", () => {
  assert.throws(
    () => parseResumeDocument('{"coverLetter":"hi"}'),
    /missing resumeHtml/,
  );
});

test("parseResumeDocument: salvages truncated JSON (unterminated string)", () => {
  // Simulate the model output being cut off mid-HTML — invalid JSON.
  const truncated = `{"resumeHtml": "<html><body><h1>Jane Doe</h1><p>Experienced `;
  const r = parseResumeDocument(truncated);
  assert.match(r.resumeHtml, /<html>/);
  assert.match(r.resumeHtml, /Jane Doe/);
});

test("parseResumeDocument: salvages code-fenced truncated resume", () => {
  const fenced = '```json\n{"resumeHtml": "<html><body>Engineer</bod';
  const r = parseResumeDocument(fenced);
  assert.match(r.resumeHtml, /<html>/);
});
