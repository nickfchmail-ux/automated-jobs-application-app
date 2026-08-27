"use client";

import TransparentButton from "@/components/TransparentButton";
import { resumeStatusCopy } from "@/lib/funnel";
import { buildResumeDocx } from "@/lib/resumeDocx";
import type { ResumeStatus } from "@/types/api";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

interface Props {
  jobId: string;
  title: string;
  company: string;
  initialStatus: ResumeStatus | null;
  resumeUrl: string | null;
  resumePdfUrl: string | null;
}

const TONE_TEXT: Record<string, string> = {
  neutral: "text-zinc-500 dark:text-zinc-400",
  active: "text-violet-600 dark:text-violet-400",
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-rose-600 dark:text-rose-400",
};

/**
 * Tailored resume for a job that matched your profile.
 *
 * The backend auto-generates a resume when a job is scored as a good fit
 * (it watches `resume_status: none → ready_to_build → building → completed`).
 * This component streams that state live and surfaces the finished HTML/PDF.
 * The "Generate" button is only shown as a fallback if a fit job somehow
 * hasn't been queued yet.
 */
export default function ResumeActions({
  jobId,
  title,
  company,
  initialStatus,
  resumeUrl,
  resumePdfUrl,
}: Props) {
  const [status, setStatus] = useState<ResumeStatus>(
    (initialStatus as ResumeStatus) ?? "none",
  );
  const [urls, setUrls] = useState<{ html: string | null; pdf: string | null }>(
    {
      html: resumeUrl,
      pdf: resumePdfUrl,
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Live updates: subscribe to jobs + generated_resumes for this job
  useEffect(() => {
    let disposed = false;
    async function listen() {
      const { getSupabaseBrowser, setSupabaseSession } =
        await import("@/lib/supabase-browser");
      const { getRealtimeSession } = await import("@/app/actions/realtime");
      const { token } = await getRealtimeSession();
      if (disposed || !token) return;
      setSupabaseSession(token);
      const sb = getSupabaseBrowser();

      const channel = sb
        .channel(`resume-${jobId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "jobs",
            filter: `id=eq.${jobId}`,
          },
          (payload) => {
            const row = payload.new as {
              resume_status?: string | null;
              resume_url?: string | null;
              resume_pdf_url?: string | null;
            };
            if (row.resume_status) setStatus(row.resume_status as ResumeStatus);
            setUrls({
              html: row.resume_url ?? null,
              pdf: row.resume_pdf_url ?? null,
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "generated_resumes",
            filter: `job_id=eq.${jobId}`,
          },
          (payload) => {
            const row = payload.new as {
              status?: string;
              resume_url?: string | null;
              pdf_url?: string | null;
            };
            if (row.status) setStatus(row.status as ResumeStatus);
            setUrls((prev) => ({
              html: row.resume_url ?? prev.html,
              pdf: row.pdf_url ?? prev.pdf,
            }));
          },
        )
        .subscribe();
      channelRef.current = channel;
    }
    void listen();
    return () => {
      disposed = true;
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch {
          /* ignore */
        }
      }
    };
  }, [jobId]);

  const copy = resumeStatusCopy(status);
  const isBuilding = status === "building" || requesting;
  const isDone = status === "completed" && (urls.html || urls.pdf);

  async function handleGenerate() {
    setError(null);
    setRequesting(true);
    try {
      const res = await fetch("/api/jobs/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error ??
            "Couldn't start your resume. Please try again in a moment.",
        );
        setRequesting(false);
        return;
      }
      // Optimistically show building — realtime will confirm
      setStatus("building");
      setRequesting(false);
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setRequesting(false);
    }
  }

  /**
   * Download the resume as a PDF with careful pagination.
   *
   * The resume is stored as print-ready HTML (A4 @page + break-inside:avoid
   * + orphan/widow control). We render it into a hidden same-origin iframe
   * and trigger the browser's print flow, which preserves the page-break CSS
   * perfectly — the user saves it as a PDF via the print dialog. This avoids
   * heavy server-side PDF tooling and keeps the pagination exact.
   */
  async function downloadPdf() {
    // If a real PDF URL exists, open it directly.
    if (urls.pdf) {
      window.open(urls.pdf, "_blank", "noopener,noreferrer");
      return;
    }
    if (!urls.html) return;
    setError(null);
    try {
      // Fetch the print-optimized HTML via the API route (correct text/html).
      const res = await fetch(`/api/resume/${jobId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

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
        throw new Error("Could not create print view");
      }
      doc.open();
      doc.write(html);
      doc.close();

      // Wait for the iframe document + any external resources to settle.
      const finish = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } finally {
          // Give the print dialog a moment before removing the frame.
          setTimeout(() => iframe.remove(), 1000);
        }
      };
      if (doc.readyState === "complete") finish();
      else
        doc.addEventListener("readystatechange", () => {
          if (doc.readyState === "complete") finish();
        });
    } catch (e) {
      console.error("[ResumeActions] downloadPdf failed:", e);
      setError(
        "Couldn't prepare the PDF. Please open 'View resume' and use your browser's print → Save as PDF.",
      );
    }
  }

  /**
   * Download the resume as a professionally-formatted Word (.docx) file.
   *
   * Fetches the stored resume HTML, parses its structure (name, contact,
   * section headings, bullets, paragraphs) and rebuilds it as a clean Word
   * document with consistent typography and spacing — ready to open/edit in
   * Word, Google Docs, etc. This is generated entirely client-side with the
   * `docx` package (the same library used for cover letters).
   */
  async function downloadWord() {
    if (!urls.html) return;
    setError(null);
    setRequesting(true);
    try {
      const res = await fetch(`/api/resume/${jobId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const blob = await buildResumeDocx(html);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume-${company.replace(/\s+/g, "-").toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[ResumeActions] downloadWord failed:", e);
      setError("Couldn't create the Word file. Please try again.");
    } finally {
      setRequesting(false);
    }
  }

  if (isBuilding) {
    return (
      <div className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/40 px-4 py-3 flex items-center gap-3">
        <svg
          className="w-4 h-4 text-violet-500 animate-spin motion-reduce:hidden"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <div>
          <p className="text-sm font-medium text-violet-700 dark:text-violet-300">
            Tailoring your resume for {company}…
          </p>
          <p className="text-xs text-violet-500 dark:text-violet-400">
            This usually takes a minute. We&apos;ll update you here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Tailored Resume
        </h2>
        <span className={`text-xs font-medium ${TONE_TEXT[copy.tone]}`}>
          {copy.label}
        </span>
      </div>

      {isDone ? (
        <div className="flex flex-wrap gap-2">
          {urls.html && (
            <a
              href={`/api/resume/${jobId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white shadow-sm hover:shadow transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1"
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
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              View resume
            </a>
          )}
          {(urls.pdf || urls.html) && (
            <button
              type="button"
              onClick={downloadPdf}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 transition-colors"
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Download PDF
            </button>
          )}
          {urls.html && (
            <button
              type="button"
              onClick={downloadWord}
              disabled={requesting}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {requesting ? "Preparing…" : "Download Word"}
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
            {status === "none" || status === "ready_to_build"
              ? "A tailored resume is being prepared for this role — it usually appears here within a minute."
              : `Generate a resume tailored to ${title} at ${company}.`}
          </p>
          {(status === "none" || status === "ready_to_build") && (
            <TransparentButton onClick={handleGenerate} color="blue">
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Generate tailored resume
            </TransparentButton>
          )}
        </>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
