"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * Full-screen overlay for ONE document type (resume OR cover letter — never
 * mixed). A TOP NAVIGATION BAR shows the VERSIONS of that document (the
 * original + each fine-tuned regeneration) so the user can flip back and
 * forth between them (v1, v2, …).
 *
 * - `type="resume"`: renders the resume HTML (iframe) + Copy + Download PDF.
 * - `type="cover-letter"`: renders the plain-text letter + Copy + Download
 *   Word.
 *
 * Copy/Download always act on the ACTIVE (currently selected) version.
 */
export default function DocumentPreviewOverlay({
  jobId,
  title,
  company,
  type,
  open,
  onClose,
}: {
  jobId: string;
  title: string;
  company: string;
  type: "resume" | "cover-letter";
  open: boolean;
  onClose: () => void;
}) {
  // Versions: array of { url, label } for this document type.
  const [versions, setVersions] = useState<{ url: string; label: string }[]>(
    [],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Tracks the last successfully-loaded versions so a transient refetch error
  // doesn't clear the nav or flash an error when we already have content.
  const versionsRef = useRef<{ url: string; label: string }[]>([]);

  // Load the version list whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setVersions([]);
    versionsRef.current = [];
    setActiveIdx(0);
    setContent(null);
    setError(null);

    const listUrl =
      type === "resume"
        ? `/api/resume/${jobId}/versions`
        : `/api/jobs/${jobId}/cover-letter/versions`;

    async function loadVersions() {
      try {
        const res = await fetch(listUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const d = await res.json();
        if (!alive) return;
        const list: { url: string; label: string }[] = Array.isArray(
          d?.versions,
        )
          ? d.versions
          : [];
        if (list.length > 0) {
          // Keep the current selection if it still exists, else jump to latest.
          versionsRef.current = list;
          setVersions(list);
          setActiveIdx((prev) => (prev < list.length ? prev : list.length - 1));
          setError(null);
        } else if (!versionsRef.current.length) {
          setError("No generated version found.");
        }
        // If the list is transiently empty but we already have versions, keep
        // showing the last known versions (no error flash).
      } catch {
        // Transient failure — keep whatever versions we already loaded and
        // only surface an error if we have NOTHING to show.
        if (alive && versionsRef.current.length === 0) {
          setError("Couldn't load the versions.");
        }
      }
    }

    void loadVersions();
    // Auto-refresh so a newly-fine-tuned version (v2, …) appears without
    // closing/reopening the overlay.
    const interval = setInterval(loadVersions, 4000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [open, jobId, type]);

  // Load the active version's content.
  useEffect(() => {
    if (!open || versions.length === 0 || !versions[activeIdx]) return;
    let alive = true;
    setContent(null);
    setError(null);
    const { url } = versions[activeIdx];
    fetch(url, { cache: "no-store" })
      .then((res) =>
        res.ok ? res.text() : Promise.reject(new Error(String(res.status))),
      )
      .then((text) => {
        if (alive) setContent(text);
      })
      .catch(() => {
        if (alive) setError("Couldn't load this version.");
      });
    return () => {
      alive = false;
    };
  }, [open, versions, activeIdx]);

  async function copyActive() {
    if (!content) return;
    const text = type === "resume" ? stripToText(content) : content;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  function downloadActive() {
    if (type === "resume") downloadResumePdf();
    else downloadLetterDocx();
  }

  function downloadResumePdf() {
    if (!content) return;
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      return;
    }
    doc.open();
    doc.write(content);
    doc.close();
    const finish = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => iframe.remove(), 1000);
      }
    };
    if (doc.readyState === "complete") finish();
    else
      doc.addEventListener("readystatechange", () => {
        if (doc.readyState === "complete") finish();
      });
  }

  async function downloadLetterDocx() {
    if (!content) return;
    setDownloading(true);
    try {
      const { Document, Packer, Paragraph, TextRun } = await import("docx");
      const paragraphs = content.split("\n").map(
        (line) =>
          new Paragraph({
            children: [
              new TextRun({ text: line.trim(), size: 24, font: "Calibri" }),
            ],
            spacing: { after: 120 },
          }),
      );
      const doc = new Document({
        sections: [
          {
            properties: {
              page: {
                margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
              },
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Cover Letter — ${title}`,
                    bold: true,
                    size: 32,
                    font: "Calibri",
                    color: "1D4ED8",
                  }),
                ],
                spacing: { after: 400 },
              }),
              ...paragraphs,
            ],
          },
        ],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cover-letter-${company.replace(/\s+/g, "-").toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top navigation bar — switch between VERSIONS of this document */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-200 dark:border-zinc-700 shrink-0 bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-400 mr-2">
              {type === "resume" ? "Tailored Resume" : "Cover Letter"}
            </span>
            {/* Version nav — ALWAYS shown (even with one version) so the user
                always has a navigation touchpoint. After a fine-tune
                regeneration a new version appears here (v1 | v2 | …). */}
            {versions.length > 0 && (
              <div className="flex items-center gap-1">
                {versions.map((v, i) => (
                  <button
                    key={v.url}
                    type="button"
                    onClick={() => setActiveIdx(i)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      i === activeIdx
                        ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                        : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-transparent"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyActive}
              disabled={!content}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {copied ? (
                <span className="text-emerald-500">Copied!</span>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Copy
                </>
              )}
            </button>
            <button
              onClick={downloadActive}
              disabled={!content}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
            >
              {downloading ? (
                <span>Exporting…</span>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  {type === "resume" ? "Download PDF" : "Download Word"}
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-white dark:bg-zinc-900">
          {error ? (
            <div className="flex items-center justify-center py-20 text-sm text-red-500">
              {error}
            </div>
          ) : type === "resume" ? (
            content ? (
              <iframe
                title="Tailored resume preview"
                className="w-full h-[80vh] border-0"
                sandbox="allow-same-origin"
                srcDoc={content}
              />
            ) : (
              <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
                Loading resume…
              </div>
            )
          ) : content ? (
            <div className="p-8">
              <p className="text-sm leading-7 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                {content}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
              Loading cover letter…
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** Strip HTML to plain text (with rough line breaks) for the Copy action. */
function stripToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  div
    .querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, div, tr")
    .forEach((el) => el.append(document.createTextNode("\n")));
  return (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
