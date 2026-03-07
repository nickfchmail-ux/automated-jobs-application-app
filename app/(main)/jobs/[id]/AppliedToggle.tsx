"use client";

import { toggleAppliedAction } from "@/app/actions/jobs";
import { formatDate } from "@/lib/dateUtils";
import { useState, useTransition } from "react";

function hkDateToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
  }).format(new Date());
}

interface Props {
  jobId: string;
  initialApplied: boolean;
  disabled?: boolean;
  appliedOn?: string;
}

export default function AppliedToggle({
  jobId,
  initialApplied,
  disabled,
  appliedOn,
}: Props) {
  const [applied, setApplied] = useState(initialApplied);
  const [localAppliedOn, setLocalAppliedOn] = useState(appliedOn);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !applied;
    setApplied(next); // optimistic
    if (next) setLocalAppliedOn(hkDateToday());
    else setLocalAppliedOn(undefined);
    startTransition(async () => {
      const result = await toggleAppliedAction(jobId, next);
      if (!result.ok) {
        setApplied(!next); // revert on error
        setLocalAppliedOn(appliedOn);
      }
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isPending || disabled}
      className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border transition-colors ${
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
          {localAppliedOn && (
            <span className="text-xs font-normal opacity-80">
              · {formatDate(localAppliedOn)}
            </span>
          )}
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
