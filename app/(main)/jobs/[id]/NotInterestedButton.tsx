"use client";

import { toggleInterestedAction } from "@/app/actions/jobs";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  jobId: string;
  initialInterestedIn: boolean | null;
}

export default function NotInterestedButton({
  jobId,
  initialInterestedIn,
}: Props) {
  const [interestedIn, setInterestedIn] = useState(initialInterestedIn);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const isNotInterested = interestedIn === false;

  function handleClick() {
    const next = !isNotInterested; // toggle: if already not-interested, revert
    const newValue = next ? false : null; // false = not interested, null = default
    setInterestedIn(newValue);
    startTransition(async () => {
      const result = await toggleInterestedAction(jobId, newValue as boolean);
      if (!result.ok) {
        setInterestedIn(initialInterestedIn); // revert on error
      } else {
        router.refresh();
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl shadow-sm transition-all hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 ${
        isNotInterested
          ? "bg-amber-600 hover:bg-amber-700 text-white border border-amber-600"
          : "bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
      }`}
    >
      <svg
        className="w-4 h-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        {isNotInterested ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        )}
      </svg>
      {isNotInterested ? "Not Interested" : "Not Interested"}
    </button>
  );
}
