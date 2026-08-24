import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/**
 * Build a professionally-formatted Word (.docx) resume from the stored
 * resume HTML. The LLM-generated HTML (e.g. the "Fong Chun Hong, Nick"
 * example) uses a simple structure: <h1> name, .contact line, <h2> section
 * headings, <h3> role/company, <ul><li> bullets, <p> paragraphs. We parse
 * that structure and rebuild it with clean, consistent Word styling:
 *
 *   - Name as a large heading, contact muted underneath
 *   - Section headings as small-caps-style uppercase rules
 *   - Bullet lists with proper hanging indents
 *   - A4 page with 1-inch margins and controlled spacing
 *
 * The HTML is generated server-side and sanitized by the evaluator, so the
 * tags we consume are the known subset below.
 */

const SECTION_COLOR = "0F766E"; // teal accent
const BODY_COLOR = "1F2933";
const MUTED_COLOR = "6B7280";
const FONT = "Calibri";

/** Extract the text content of an HTML element by tag. */
function tagText(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(stripTags(m[1]).trim());
  }
  return out;
}

/** Remove any nested HTML tags from a string. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00A0/g, " ")
    .trim();
}

/** Extract bullet list items across the whole document. */
function listItems(html: string): string[] {
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = stripTags(m[1]);
    if (t) out.push(t);
  }
  return out;
}

/** Extract <p> paragraph text. */
function paragraphs(html: string): string[] {
  return tagText(html, "p")
    .map((t) => stripTags(t))
    .filter(Boolean);
}

/** Extract <h3> sub-headings (role + company). */
function subHeadings(html: string): string[] {
  return tagText(html, "h3").filter(Boolean);
}

/**
 * Parse the resume HTML into a professional docx Document.
 * Returns a Blob ready to download as .docx.
 */
export async function buildResumeDocx(html: string): Promise<Blob> {
  // Name (h1) — first one.
  const names = tagText(html, "h1");
  const name = names[0] || "Resume";

  // Contact line: the .contact div / first paragraph after name.
  const contactMatch = html.match(
    /<div[^>]*class=["'][^"']*contact[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const contact = contactMatch ? stripTags(contactMatch[1]) : "";

  const h2s = tagText(html, "h2").filter(Boolean);
  const lis = listItems(html);
  const ps = paragraphs(html);
  const h3s = subHeadings(html);

  // Rebuild the document as a sequence of blocks in source order.
  // Strategy: iterate the raw HTML by top-level nodes to preserve order.
  const children: Paragraph[] = [];

  // Header
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: name, bold: true, size: 40, font: FONT, color: "111827" }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }),
  );
  if (contact) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: contact, size: 20, font: FONT, color: MUTED_COLOR })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      }),
    );
  }
  children.push(
    new Paragraph({
      border: { bottom: { color: SECTION_COLOR, style: BorderStyle.SINGLE, size: 8 } },
      spacing: { after: 200 },
      text: "",
    }),
  );

  // Walk the HTML body in order and emit blocks.
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  const sectionRe =
    /<(h1|h2|h3|ul|p|div)\b[^>]*>([\s\S]*?)<\/\1>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(body)) !== null) {
    const tag = (m[1] || "li").toLowerCase();
    const inner = m[2] ?? m[3] ?? "";
    const text = stripTags(inner);

    if (tag === "h1") {
      // Already emitted the name header — skip duplicates.
      continue;
    } else if (tag === "h2") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: text.toUpperCase(),
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
            new TextRun({ text, bold: true, size: 23, font: FONT, color: "111827" }),
          ],
          spacing: { before: 160, after: 40 },
        }),
      );
    } else if (tag === "ul") {
      // Parse the <li> inside this list.
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(inner)) !== null) {
        const liText = stripTags(li[1]);
        if (!liText) continue;
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "•  ", size: 22, font: FONT, color: SECTION_COLOR }),
              new TextRun({ text: liText, size: 22, font: FONT, color: BODY_COLOR }),
            ],
            indent: { left: 360, hanging: 200 },
            spacing: { after: 60 },
          }),
        );
      }
    } else if (tag === "p" && text) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text, size: 22, font: FONT, color: BODY_COLOR })],
          spacing: { after: 80 },
        }),
      );
    }
    // div: handled via its children; skip wrapper text.
  }

  // Fallback: if the walk produced nothing beyond the header, emit the
  // extracted content so a resume is still produced.
  if (children.length <= 3) {
    for (const h of h2s) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 22, font: FONT, color: SECTION_COLOR })],
          spacing: { before: 240, after: 80 },
        }),
      );
    }
    for (const sub of h3s) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: sub, bold: true, size: 23, font: FONT })],
          spacing: { before: 160, after: 40 },
        }),
      );
    }
    for (const p of ps) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: p, size: 22, font: FONT, color: BODY_COLOR })],
          spacing: { after: 80 },
        }),
      );
    }
    for (const li of lis) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "•  ", size: 22, font: FONT, color: SECTION_COLOR }),
            new TextRun({ text: li, size: 22, font: FONT, color: BODY_COLOR }),
          ],
          indent: { left: 360, hanging: 200 },
          spacing: { after: 60 },
        }),
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
