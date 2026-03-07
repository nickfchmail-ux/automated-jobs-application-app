"use client";

import TransparentButton from "@/components/TransparentButton";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { useEffect, useState } from "react";
import CoverLetterButton from "./CoverLetterButton";

interface Props {
  letter: string;
  title: string;
  company: string;
}

async function buildDocx(
  letter: string,
  title: string,
  company: string,
): Promise<Blob> {
  const lines = letter.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      paragraphs.push(new Paragraph({ text: "" }));
    } else {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 24, font: "Calibri" })],
          spacing: { after: 120 },
          alignment: AlignmentType.LEFT,
        }),
      );
    }
  }

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
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: company,
                size: 24,
                font: "Calibri",
                color: "6B7280",
              }),
            ],
            spacing: { after: 400 },
          }),
          new Paragraph({
            border: {
              bottom: { color: "DBEAFE", style: BorderStyle.SINGLE, size: 8 },
            },
            spacing: { after: 400 },
            text: "",
          }),
          ...paragraphs,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}

export default function CoverLetterActions({ letter, title, company }: Props) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(letter);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const blob = await buildDocx(letter, title, company);
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

  useEffect(() => {
    if (!modalOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModalOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  return (
    <>
      <div className="flex items-center gap-2">
        <CoverLetterButton
          setOpen={setModalOpen}
          handleDownload={handleDownload}
          downloading={downloading}
        />
      </div>

      {/* Cover Letter Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl border border-zinc-200 dark:border-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
              <span className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-400">
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
                Cover Letter
              </span>
              <div className="flex items-center gap-2">
                <TransparentButton onClick={handleCopy} color="black">
                  {copied ? (
                    <>
                      <svg
                        className="w-4 h-4 text-emerald-500"
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
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Copied!
                      </span>
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
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      Copy
                    </>
                  )}
                </TransparentButton>

                <button
                  onClick={() => setModalOpen(false)}
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

            {/* Modal body — scrollable */}
            <div className="overflow-y-auto p-6">
              <p className="text-sm leading-7 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-(family-name:--font-geist-sans)">
                {letter}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
