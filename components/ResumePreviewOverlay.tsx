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
          <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">
            Tailored Resume
          </span>
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
