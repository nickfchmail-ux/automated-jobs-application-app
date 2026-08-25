import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/**
 * Build a Word (.docx) resume that MATCHES the print-ready HTML/PDF version.
 *
 * The resume is stored as a well-formed HTML document (the same one rendered
 * for View + PDF via print). The old implementation re-parsed that HTML with
 * regex heuristics, which produced a DIFFERENT result from the PDF whenever
 * the structure didn't match the expected tags — content got dropped or
 * reordered. This rewrite uses the browser's native DOMParser to walk the
 * REAL DOM tree in document order, so the Word document faithfully mirrors
 * the HTML the PDF renders: same sections, same order, same content.
 */
const SECTION_COLOR = "0F766E";
const BODY_COLOR = "1F2933";
const MUTED_COLOR = "6B7280";
const FONT = "Calibri";

/** Inline styled runs (bold/italic) from an element's text nodes. */
function textRunsFromNode(node: Element): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (n: Node) => {
    for (const child of Array.from(n.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const el = n as Element;
        const st = el.getAttribute("style")?.toLowerCase() ?? "";
        const bold =
          el.tagName === "B" ||
          el.tagName === "STRONG" ||
          st.includes("font-weight:bold") ||
          st.includes("font-weight: bold") ||
          st.includes("font-weight:700");
        const italic =
          el.tagName === "I" || el.tagName === "EM" || st.includes("font-style:italic");
        runs.push(
          new TextRun({
            text,
            size: 22,
            font: FONT,
            color: BODY_COLOR,
            bold: bold || undefined,
            italics: italic || undefined,
          }),
        );
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(node);
  return runs;
}

/** Plain text of a node (for headings / contact). */
function nodeText(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Convert the stored resume HTML into a Word Document mirroring the PDF. */
export async function buildResumeDocx(html: string): Promise<Blob> {
  // Defensive: never let LLM/editor placeholder junk ("#attachment:Pasted
  // text #1", markdown embeds, code fences) leak into the Word document.
  const clean = (html ?? "")
    .replace(/#attachment:\s*[^\n]*/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[(?:attachment|image|paste)[^\]]*\]/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n");

  // If the input isn't HTML at all (e.g. an empty or error response), emit a
  // plain "Resume" doc instead of the raw garbage text.
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(clean);
  if (!looksLikeHtml || !clean.trim()) {
    const text = clean.trim() || "Resume";
    return Packer.toBlob(
      new Document({
        sections: [
          {
            properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
            children: [
              new Paragraph({
                children: [new TextRun({ text, size: 22, font: FONT, color: BODY_COLOR })],
              }),
            ],
          },
        ],
      }),
    );
  }

  const doc = new DOMParser().parseFromString(clean, "text/html");
  const body = doc.body;
  const children: Paragraph[] = [];

  const emit = (node: Element) => {
    const tag = node.tagName.toLowerCase();
    if (tag === "h1") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: nodeText(node), bold: true, size: 40, font: FONT, color: "111827" }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
      );
    } else if (tag === "h2") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: nodeText(node).toUpperCase(),
              bold: true,
              size: 22,
              font: FONT,
              color: SECTION_COLOR,
            }),
          ],
          spacing: { before: 240, after: 80 },
          border: { bottom: { color: "CCFBF1", style: BorderStyle.SINGLE, size: 4 } },
        }),
      );
    } else if (tag === "h3") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: nodeText(node), bold: true, size: 23, font: FONT, color: "111827" }),
          ],
          spacing: { before: 160, after: 40 },
        }),
      );
    } else if (tag === "p") {
      if (!nodeText(node)) return;
      children.push(new Paragraph({ children: textRunsFromNode(node), spacing: { after: 80 } }));
    } else if (tag === "li") {
      if (!nodeText(node)) return;
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "\u2022  ", size: 22, font: FONT, color: SECTION_COLOR }),
            ...textRunsFromNode(node),
          ],
          indent: { left: 360, hanging: 200 },
          spacing: { after: 60 },
        }),
      );
    } else if (tag === "div") {
      const cls = (node.className || "").toLowerCase();
      const isName = cls.includes("name") || cls.includes("resume-header");
      const isContact = cls.includes("contact");
      const text = nodeText(node);
      if (!text) return;
      if (isName) {
        // The candidate's name — render as a large centered heading (matches
        // the PDF's prominent name header), not plain text.
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text, bold: true, size: 40, font: FONT, color: "111827" }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
          }),
        );
      } else {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text,
                size: isContact ? 20 : 22,
                font: FONT,
                color: isContact ? MUTED_COLOR : BODY_COLOR,
              }),
            ],
            alignment: isContact ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { after: isContact ? 200 : 80 },
          }),
        );
      }
    }
  };

  // Walk the body's direct children in order (preserves PDF document order).
  // Unknown container elements (e.g. <section>) are RECURSED into so their
  // nested h2/h3/ul/p content is emitted too — this was the bug that dropped
  // the whole resume body when the LLM wrapped it in a <section>.
  const walk = (node: Element) => {
    const tag = node.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      for (const li of Array.from(node.querySelectorAll(":scope > li"))) {
        emit(li as Element);
      }
      return;
    }
    // Leaf content tags → emit directly.
    if (["h1", "h2", "h3", "p", "li", "div"].includes(tag)) {
      emit(node);
      return;
    }
    // Container (section, article, main, header, span wrappers…) → recurse
    // into its element children.
    for (const child of Array.from(node.children)) {
      walk(child as Element);
    }
  };

  for (const child of Array.from(body.children)) {
    walk(child as Element);
  }

  if (children.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: (body.textContent ?? "").replace(/\s+/g, " ").trim() || "Resume",
            size: 22,
            font: FONT,
            color: BODY_COLOR,
          }),
        ],
      }),
    );
  }

  const wordDoc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children,
      },
    ],
  });

  return Packer.toBlob(wordDoc);
}
