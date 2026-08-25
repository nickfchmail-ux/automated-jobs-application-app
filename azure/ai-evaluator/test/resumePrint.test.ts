import assert from "node:assert/strict";
import test from "node:test";
import { enhanceResumeForPrint } from "../src/lib/resumePrint.js";

test("enhanceResumeForPrint: injects print CSS into full HTML doc", () => {
  const html =
    "<html><head><title>R</title></head><body><h1>Name</h1></body></html>";
  const out = enhanceResumeForPrint(html);
  assert.match(out, /@page\s*\{\s*size: A4/);
  assert.match(out, /break-inside:\s*avoid/);
  assert.match(out, /orphans:\s*3/);
  // CSS injected in head
  const head = out.slice(0, out.indexOf("</head>"));
  assert.match(head, /<style>/);
});

test("enhanceResumeForPrint: wraps a bare fragment in a full doc", () => {
  const out = enhanceResumeForPrint("<h1>Jane</h1><p>Dev</p>");
  assert.match(out, /^<!DOCTYPE html>/);
  assert.match(out, /<html>/);
  assert.match(out, /@page\s*\{\s*size: A4/);
  assert.match(out, /<h1>Jane<\/h1>/);
});

test("enhanceResumeForPrint: adds head when html exists but no head", () => {
  const out = enhanceResumeForPrint("<html><body><h1>X</h1></body></html>");
  assert.match(out, /<head><style>/);
  assert.match(out, /@page\s*\{\s*size: A4/);
});

test("enhanceResumeForPrint: preserves resume content", () => {
  const html =
    "<html><body><h1>Nick</h1><div class='contact'>hk</div><ul><li>skill</li></ul></body></html>";
  const out = enhanceResumeForPrint(html);
  assert.match(out, /<h1>Nick<\/h1>/);
  assert.match(out, /<li>skill<\/li>/);
});

test("enhanceResumeForPrint: converts hyperlinks to visible plain text (URLs print in PDF)", () => {
  // A link with text → "Text (URL)" so the URL is visible on paper.
  const withText =
    "<html><body><a href='https://github.com/nick'>GitHub</a></body></html>";
  const out1 = enhanceResumeForPrint(withText);
  assert.ok(!/<a\b/i.test(out1), "no <a> tag remains");
  assert.match(out1, /GitHub \(https:\/\/github\.com\/nick\)/);

  // A bare link (no text) → just the URL as visible text.
  const bare =
    "<html><body><a href='https://linkedin.com/in/nick'></a></body></html>";
  const out2 = enhanceResumeForPrint(bare);
  assert.ok(!/<a\b/i.test(out2), "no <a> tag remains");
  assert.match(out2, /https:\/\/linkedin\.com\/in\/nick/);

  // Even if a link slips through, print CSS makes it plain (not underlined/colored).
  const out3 = enhanceResumeForPrint(
    "<html><body><a href='https://x.com'>x</a></body></html>",
  );
  assert.match(out3, /a\s*\{\s*text-decoration:\s*none\s*!important/);
});
