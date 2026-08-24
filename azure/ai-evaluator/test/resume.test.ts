import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeResume } from "../src/lib/resume.js";

const SAMPLE_RESUME = `# Jane Doe
jane.doe@example.com · +852 9123 4567
Hong Kong · linkedin.com/in/janedoe

## Professional Summary
Senior Software Engineer with 8 years building React and TypeScript apps.

## Skills
- React, TypeScript, Node.js, Azure

## Experience
### Senior Engineer — Acme Corp (2020-2024)
- Led a team of 5 building a job platform.
- Improved API latency by 40%.
`;

test("sanitizeResume: evaluation mode strips email, phone, address, links", () => {
  const out = sanitizeResume(SAMPLE_RESUME, { includeContact: false });
  assert.ok(!/@/.test(out), "email should be redacted");
  assert.ok(!/9123 4567/.test(out), "phone should be redacted");
  assert.ok(!/linkedin/i.test(out), "linkedin link should be redacted");
  assert.ok(!/Hong Kong/.test(out), "address should be redacted");
  // Content preserved
  assert.ok(/Senior Software Engineer/.test(out));
  assert.ok(/React and TypeScript/.test(out));
  assert.ok(/Acme Corp/.test(out));
});

test("sanitizeResume: document mode keeps contact but strips IDs/DOB", () => {
  const withId = `# John\njohn@x.com\nHKID: A123456(7)\n## Skills\n- Go`;
  const out = sanitizeResume(withId, { includeContact: true });
  assert.ok(/john@x.com/.test(out), "email kept for documents");
  assert.ok(
    !/A123456/.test(out),
    "HKID should be redacted even in document mode",
  );
});

test("sanitizeResume: preserves truthful resume facts", () => {
  const out = sanitizeResume(SAMPLE_RESUME, { includeContact: false });
  assert.ok(/8 years/.test(out));
  assert.ok(/Led a team of 5/.test(out));
  assert.ok(/2020-2024/.test(out));
});

test("sanitizeResume: collapses repeated blank lines and trims", () => {
  const out = sanitizeResume("a\n\n\n\n\nb", { includeContact: false });
  assert.ok(!/\n{3,}/.test(out));
});

test("sanitizeResume: preserves employment date ranges (2020-2024), redacts DOB", () => {
  const text =
    "## Experience\n- Senior Engineer at Acme (2020-2024)\nDOB: 12/03/1990";
  const out = sanitizeResume(text, { includeContact: false });
  assert.ok(/2020-2024/.test(out), "year range must survive");
  assert.ok(!/12\/03\/1990/.test(out), "real DOB must be redacted");
});

test("sanitizeResume: does not treat year ranges as phone numbers", () => {
  const out = sanitizeResume("2020-2024", { includeContact: false });
  assert.ok(/2020-2024/.test(out), "year range not redacted as phone");
});
