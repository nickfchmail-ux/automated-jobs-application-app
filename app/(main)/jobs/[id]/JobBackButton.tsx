"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Back button for the job detail page.
 *
 * When the user arrived from a list with a `?from=` query param (e.g.
 * `/jobs/{id}?from=/matches`), the button is a plain <Link> back to that
 * list — reliable even if the page was opened in a new tab or the history
 * was otherwise lost.
 *
 * Otherwise it uses `router.back()` so it returns to exactly where the user
 * came from (preserving the browser's scroll position on the matches row
 * they clicked).
 */
export default function JobBackButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");

  if (from) {
    return (
      <Link
        href={from}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
      >
        <ArrowBackIcon fontSize="small" />
        Back to matches
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
    >
      <ArrowBackIcon fontSize="small" />
      Back
    </button>
  );
}
