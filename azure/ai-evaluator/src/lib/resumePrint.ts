/**
 * Print/PDF-optimization for generated tailored resumes.
 *
 * The LLM returns a raw HTML resume (inline-styled). Before storing it we
 * inject a professional print stylesheet so that when the user opens the
 * resume or prints/saves it as PDF, it paginates cleanly:
 *
 *   - A4 page size with sensible margins
 *   - sections never split across pages (break-inside: avoid)
 *   - headings stay with their following content (break-after: avoid)
 *   - no orphan/widow single lines
 *   - print colors preserved (print-color-adjust: exact)
 */

const PRINT_CSS = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: 'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif;
    color: #1f2933;
    background: #fff;
    max-width: 794px; /* A4 @96dpi */
    margin: 0 auto;
    padding: 24px 32px;
    line-height: 1.4;
    font-size: 12.5px;
  }
  h1 { font-size: 22px; margin: 0 0 2px; color: #0f172a; }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #0f766e;
    border-bottom: 1.5px solid #99f6e4;
    padding-bottom: 2px;
    margin: 12px 0 6px;
    break-after: avoid; /* heading stays with its content */
  }
  h3 { font-size: 13px; margin: 8px 0 2px; break-after: avoid; }
  p { margin: 2px 0 4px; }
  ul { margin: 2px 0 6px; padding-left: 16px; }
  li { margin: 1px 0; }
  .contact { font-size: 11.5px; color: #52606d; margin-top: 3px; }
  .project, section { break-inside: avoid; } /* never split a section across pages */
  .project { margin-bottom: 6px; }
  .project-title { font-weight: 600; }
  strong { color: #111827; }
  a { color: #0f766e; text-decoration: none; }

  /* ── Print: A4, no split headings/sections, no orphan lines ── */
  @page { size: A4; margin: 12mm 11mm; }
  @media print {
    body { padding: 0; max-width: 100%; font-size: 11.5px; line-height: 1.35; }
    h1, h2, h3 { break-after: avoid; }
    section, .project { break-inside: avoid; }
    p, li { orphans: 3; widows: 3; }
    a { color: inherit; }
  }
`;

/**
 * Inject the print-optimized stylesheet into a raw LLM-generated resume HTML
 * document. If the HTML already has a <style> block, our CSS is appended so
 * it wins on print; otherwise we insert a <style> in <head>.
 */
export function enhanceResumeForPrint(rawHtml: string): string {
  const styleTag = `<style>${PRINT_CSS}</style>`;

  // If it's a full document with </head>, inject before it.
  if (/<\/head>/i.test(rawHtml)) {
    return rawHtml.replace(/<\/head>/i, `${styleTag}</head>`);
  }

  // If it has an opening <html> but no head, add a head.
  if (/<html[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(
      /<html[^>]*>/i,
      (m) => `${m}<head>${styleTag}</head>`,
    );
  }

  // Bare fragment → wrap in a full document.
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${styleTag}</head><body>${rawHtml}</body></html>`;
}
