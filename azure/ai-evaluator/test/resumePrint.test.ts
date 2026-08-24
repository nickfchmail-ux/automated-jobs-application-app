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
