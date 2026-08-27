"use client";

import { uploadResumeAction } from "@/app/actions/resume";
import { useToast } from "@/components/Toast";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Props = {
  userId: string;
  fileName: string | null;
  signedUrl: string | null;
};

export default function ResumePanel({ userId, fileName, signedUrl }: Props) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setSelectedFile(f);
    setError(null);
    setSuccess(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) {
      setSelectedFile(f);
      setError(null);
      setSuccess(false);
    }
  }

  function handleUpload() {
    if (!selectedFile) {
      setError("Please select a file first.");
      return;
    }
    const fd = new FormData();
    fd.append("resume", selectedFile);
    startTransition(async () => {
      const result = await uploadResumeAction(fd);
      if (!result.ok) {
        setError(result.error);
        toast.error("Upload failed", result.error);
      } else {
        setSuccess(true);
        setSelectedFile(null);
        if (fileRef.current) fileRef.current.value = "";
        toast.success(
          hasResume ? "Resume replaced" : "Resume uploaded",
          hasResume
            ? "Your new resume is now what the AI scores jobs against."
            : "You're ready to start matching jobs.",
        );
        router.refresh();
      }
    });
  }

  const hasResume = !!fileName;

  return (
    <div className="space-y-6">
      {/* Current resume card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">
          Current Resume
        </h2>

        {hasResume ? (
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
                <svg
                  className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
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
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                  {fileName}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Uploaded to Supabase Storage
                </p>
              </div>
            </div>

            {signedUrl ? (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
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
                Download
              </a>
            ) : (
              <span className="text-xs text-zinc-400">URL unavailable</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
            <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-zinc-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                No resume uploaded yet
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Upload a PDF, DOC, or DOCX below
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Upload card */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-1">
          {hasResume ? "Replace Resume" : "Upload Resume"}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5">
          {hasResume
            ? "Uploading a new file will permanently replace your current resume."
            : "Accepted formats: PDF, DOC, DOCX"}
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 flex flex-col items-center gap-3 transition-colors ${
            isDragging
              ? "border-violet-400 bg-violet-50 dark:bg-violet-950/30"
              : selectedFile
                ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20"
                : "border-zinc-300 dark:border-zinc-700 hover:border-violet-400 dark:hover:border-violet-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          }`}
        >
          {selectedFile ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-emerald-600 dark:text-emerald-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {(selectedFile.size / 1024).toFixed(0)} KB · Click to change
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-zinc-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Drag & drop or click to browse
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                  PDF, DOC, DOCX up to 10 MB
                </p>
              </div>
            </>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Feedback */}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <svg
              className="w-4 h-4 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            Resume {hasResume ? "replaced" : "uploaded"} successfully!
          </div>
        )}

        {/* Upload button */}
        <button
          onClick={handleUpload}
          disabled={!selectedFile || isPending}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 text-white font-medium text-sm px-4 py-3 shadow-sm hover:shadow transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1"
        >
          {isPending ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
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
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              Uploading…
            </>
          ) : (
            <>
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
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              {hasResume ? "Replace Resume" : "Upload Resume"}
            </>
          )}
        </button>
      </div>

      {/* Info */}
      <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-5 py-4 text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
        <p className="font-semibold text-zinc-600 dark:text-zinc-300">
          Storage info
        </p>
        <p>
          User ID:{" "}
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            {userId}
          </span>
        </p>
        <p>
          File name pattern:{" "}
          <span className="font-mono text-zinc-700 dark:text-zinc-300">
            {userId}-resume.&#123;ext&#125;
          </span>
        </p>
        <p>
          Only one resume is stored per account. Uploading a new file replaces
          the old one.
        </p>
      </div>
    </div>
  );
}
