"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Full-screen overlay that renders the tailored resume HTML in a styled
 * iframe/container — instead of opening a new browser tab. Esc closes it.
 */
export default function ResumePreviewOverlay({
  jobId,
  open,
  onClose,
}: {
  jobId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fetch the resume HTML whenever the overlay opens. State is only set in
  // async callbacks (never synchronously in the effect body). The parent
  // conditionally mounts this component (only when open), so `html`/`error`
  // start fresh each time it opens.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`/api/resume/${jobId}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (alive) setHtml(text);
      })
      .catch(() => {
        if (alive) setError("Couldn't load the resume. Please try again.");
      });
    return () => {
      alive = false;
    };
  }, [open, jobId]);

  /** Copy the ACTIVE (currently shown) resume as plain text to the clipboard. */
  async function copyResume() {
    if (!html) return;
    // Strip tags to get readable plain text (keep line breaks roughly).
    const div = document.createElement("div");
    div.innerHTML = html;
    // Replace </p>, </li>, </h1-6>, </div> with newlines for readability.
    div
      .querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, div, tr")
      .forEach((el) => el.append(document.createTextNode("\n")));
    const text = (div.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  }

  /**
   * Download the ACTIVE (currently shown) resume as a PDF. Opens a hidden
   * iframe with the resume HTML and triggers the browser print dialog so the
   * user can "Save as PDF" — which respects the print CSS.
   */
  function downloadPdf() {
    if (!html) return;
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
    doc.write(html);
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
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0 bg-white dark:bg-zinc-900">
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-400">
            Tailored Resume
          </span>
          <div className="flex items-center gap-2">
            {/* Copy the ACTIVE resume (the one currently shown) as text. */}
            <button
              onClick={copyResume}
              disabled={!html}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {copied ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 text-emerald-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Copied!
                </>
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
            {/* Download the ACTIVE resume (the one currently shown) as a PDF. */}
            <button
              onClick={downloadPdf}
              disabled={!html}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
            >
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
              Download PDF
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

        {/* Body — renders the resume HTML in a sandboxed iframe. No spinner
            here: the resume is already generated; we just fetch + display it. */}
        <div className="flex-1 overflow-auto bg-white">
          {error ? (
            <div className="flex items-center justify-center py-20 text-sm text-red-500">
              {error}
            </div>
          ) : html ? (
            <iframe
              title="Tailored resume preview"
              className="w-full h-[80vh] border-0"
              sandbox="allow-same-origin"
              srcDoc={html}
            />
          ) : (
            <div className="flex items-center justify-center py-20 text-sm text-zinc-400">
              Loading resume…
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
