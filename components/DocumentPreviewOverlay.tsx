"use client";

import {
  triggerCoverLetterAction,
  triggerResumeAction,
} from "@/app/actions/documents";
import { useJobState } from "@/components/JobStateProvider";
import DotLoader from "@/components/DotLoader";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

/** One entry in the version nav (derived from `documentVersions`). */
interface NavVersion {
  id: string;
  version: number;
  label: string;
  status: "building" | "completed" | "failed";
  url: string | null;
  refinement: string | null;
  basedOn: number | null;
  error: string | null;
}

/**
 * Full-screen overlay for ONE document type (resume OR cover letter — never
 * mixed). A TOP NAVIGATION BAR shows the VERSIONS of that document (the
 * original + each fine-tuned regeneration) so the user can flip back and
 * forth between them (v1, v2, …).
 *
 * Per-version state comes from `document_versions` (via the shared
 * JobStateProvider + Supabase Realtime), so:
 *   - a `building` version shows a spinner on its tab — the overlay knows
 *     "it's generating" and renders that instead of a broken fetch
 *   - when it flips to `completed` the new version becomes clickable + the
 *     viewer loads it (no manual refresh)
 *   - a `failed` version shows the error + a Retry / Fine-tune path
 *
 * A "Fine-tune this version" panel lives INSIDE the overlay — the user picks
 * a version, types what to change, and the regeneration streams in as the
 * NEXT version (v2 → v3 → …) over Realtime.
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
  const { documentVersions } = useJobState();
  // The doc type's versions, sorted ascending (v1, v2, …).
  const versions = useMemo<NavVersion[]>(
    () =>
      (documentVersions ?? [])
        .filter((v) => v.doc_type === type)
        .sort((a, b) => a.version - b.version)
        .map((v) => ({
          id: v.id,
          version: v.version,
          label: `v${v.version}`,
          status: v.status,
          url: v.url,
          refinement: v.refinement,
          basedOn: v.based_on,
          error: v.error,
        })),
    [documentVersions, type],
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Fine-tune panel state.
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [refinement, setRefinement] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [fineTuneError, setFineTuneError] = useState<string | null>(null);

  // The active version object (may be undefined while loading).
  const active = versions[activeIdx];

  // Jump to the newest completed version when:
  //  - the overlay opens (versions already exist), or
  //  - a fine-tune completes (a building version flips to completed).
  // Tracking the newest COMPLETED version (not just the highest number)
  // matters because a building version bumps the number before it's ready.
  const prevNewestCompleted = useRef(0);
  useEffect(() => {
    if (!open) return;
    const newestCompleted = [...versions]
      .reverse()
      .find((v) => v.status === "completed");
    const newestVersion = newestCompleted?.version ?? 0;
    if (newestVersion > prevNewestCompleted.current && newestCompleted) {
      const idx = versions.findIndex((v) => v.id === newestCompleted.id);
      if (idx !== -1) {
        setActiveIdx(idx);
        // A fine-tune finished → close the panel so the fresh result shows.
        setFineTuneOpen(false);
        setRefinement("");
      }
    }
    prevNewestCompleted.current = newestVersion;
  }, [versions, open]);

  // Guard: if the active version disappears or becomes building, don't leave
  // a stale selection — fall back to the newest completed.
  useEffect(() => {
    if (!open || versions.length === 0) {
      setActiveIdx(0);
      return;
    }
    if (activeIdx >= versions.length) {
      setActiveIdx(versions.length - 1);
      return;
    }
    const v = versions[activeIdx];
    if (v && v.status === "building") {
      const ready = [...versions]
        .reverse()
        .find((x) => x.status === "completed");
      if (ready) {
        setActiveIdx(versions.findIndex((x) => x.id === ready.id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, open]);

  // Fetch the active version's CONTENT. For a building version we show the
  // "Generating…" state instead of fetching (the file isn't there yet).
  useEffect(() => {
    if (!open || !active) {
      setContent(null);
      setError(null);
      return;
    }
    if (active.status === "building") {
      setContent(null);
      setError(null);
      return;
    }
    if (active.status === "failed") {
      setContent(null);
      setError(active.error ?? "This version failed to generate.");
      return;
    }
    let alive = true;
    setContent(null);
    setError(null);
    const url =
      active.url ??
      (type === "resume"
        ? `/api/resume/${jobId}/versions/${active.version}`
        : `/api/jobs/${jobId}/cover-letter/versions/${active.version}`);
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
  }, [open, active, jobId, type]);

  // When a fine-tune is in flight (the latest version is building), keep the
  // fine-tune panel visible showing progress. The Realtime row flip to
  // `completed` auto-updates `versions` → the new tab appears + loads.
  const latestBuilding = useMemo(
    () => [...versions].reverse().find((v) => v.status === "building"),
    [versions],
  );

  async function handleFineTune() {
    const note = refinement.trim();
    if (!note) {
      setFineTuneError("Tell us what to change before regenerating.");
      return;
    }
    setFineTuneError(null);
    setRequesting(true);
    const basedOn = active?.version ?? undefined;
    const res =
      type === "resume"
        ? await triggerResumeAction(jobId, note, basedOn)
        : await triggerCoverLetterAction(jobId, note, basedOn);
    setRequesting(false);
    if (!res.ok) {
      setFineTuneError(
        /resume/i.test(res.error)
          ? "Upload a resume first, then try again."
          : "Couldn't start the regeneration. Please try again in a moment.",
      );
      return;
    }
    // Keep the fine-tune panel open — it now shows "Regenerating…" and flips
    // to the completed view when Realtime delivers the new version.
    setRefinement("");
  }

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

  // The ACTIVE version is the one driving the body. A separate building
  // version (e.g. a fine-tune in flight while the user views an older one)
  // only affects the nav — the body still shows the viewable active version.
  const isActiveBuilding = active?.status === "building";

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
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-400 mr-2 whitespace-nowrap">
              {type === "resume" ? "Tailored Resume" : "Cover Letter"}
            </span>
            {/* Version nav — ALWAYS shown (even with one version) so the user
                always has a navigation touchpoint. Building versions show a
                spinner instead of being clickable. */}
            {versions.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto">
                {versions.map((v, i) => {
                  const isActive = i === activeIdx;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={v.status === "building"}
                      onClick={() => setActiveIdx(i)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-wait ${
                        isActive
                          ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                          : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 border border-transparent"
                      }`}
                    >
                      {v.label}
                      {v.status === "building" && (
                        <DotLoader
                          dotClassName="bg-indigo-400"
                          className="scale-50 origin-center"
                        />
                      )}
                      {v.status === "failed" && (
                        <span className="text-rose-500" title={v.error ?? ""}>
                          !
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={copyActive}
              disabled={!content || isActiveBuilding}
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
              disabled={!content || isActiveBuilding}
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
          {isActiveBuilding ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center px-6">
              <DotLoader dotClassName="bg-indigo-500" />
              <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                {latestBuilding?.refinement
                  ? "Fine-tuning your document…"
                  : type === "resume"
                    ? "Tailoring your resume…"
                    : "Writing your cover letter…"}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md">
                {latestBuilding?.refinement
                  ? `Applying “${latestBuilding.refinement}” — this usually takes under a minute. You can leave this page; we’ll update you here.`
                  : "This usually takes under a minute. You can leave this page; we’ll update you here."}
              </p>
            </div>
          ) : error && !content ? (
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

        {/* Bottom bar — Fine-tune this version */}
        <div className="px-6 py-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0 bg-white dark:bg-zinc-900">
          {fineTuneOpen ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Fine-tune{" "}
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {active?.label ?? ""}
                  </span>{" "}
                  → creates v{(active?.version ?? 0) + 1}
                </span>
                <button
                  onClick={() => {
                    setFineTuneOpen(false);
                    setFineTuneError(null);
                  }}
                  className="text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
              <textarea
                value={refinement}
                onChange={(e) => setRefinement(e.target.value)}
                disabled={requesting || isActiveBuilding}
                rows={2}
                placeholder={
                  type === "resume"
                    ? "e.g. Emphasize my document processing and Excel skills; keep it to one page."
                    : "e.g. Make it more concise and professional; focus on my administrative experience."
                }
                className="w-full rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-none disabled:opacity-60"
              />
              {fineTuneError && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {fineTuneError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={handleFineTune}
                  disabled={requesting || isActiveBuilding}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
                >
                  {requesting ? (
                    <>
                      <DotLoader dotClassName="bg-white" className="scale-75" />
                      Starting…
                    </>
                  ) : (
                    "Regenerate"
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {active?.refinement
                  ? `This version was fine-tuned: “${active.refinement}”`
                  : active?.basedOn
                    ? `Built from v${active.basedOn}`
                    : versions.length > 1
                      ? "Flip between the original and each fine-tuned version."
                      : "Original version"}
              </span>
              <button
                onClick={() => {
                  setFineTuneOpen(true);
                  setFineTuneError(null);
                }}
                disabled={!active || active.status !== "completed"}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Fine-tune {active?.label ?? "this version"}
              </button>
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
