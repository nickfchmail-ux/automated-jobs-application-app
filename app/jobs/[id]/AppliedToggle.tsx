"use client";

import { toggleAppliedAction } from "@/app/actions/jobs";
import { useState, useTransition } from "react";

interface Props {
  jobId: string;
  initialApplied: boolean;
}

export default function AppliedToggle({ jobId, initialApplied }: Props) {
  const [applied, setApplied] = useState(initialApplied);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !applied;
    setApplied(next); // optimistic
    startTransition(async () => {
      const result = await toggleAppliedAction(jobId, next);
      if (!result.ok) {
        setApplied(!next); // revert on error
      }
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
        applied
          ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
          : "bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border-zinc-300 dark:border-zinc-600"
      }`}
    >
      {applied ? (
        <>
          <svg
            className="w-4 h-4"
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
          Applied
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
              d="M12 4v16m8-8H4"
            />
          </svg>
          Mark as Applied
        </>
      )}
    </button>
  );
}
