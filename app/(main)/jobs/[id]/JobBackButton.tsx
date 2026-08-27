"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Back button that replaces the JobSeek logo on job detail pages.
 *
 * Always shows just "Back". The destination is:
 *   - `?from=` present → a reliable <Link> to that list (e.g. /matches)
 *   - otherwise → router.back() (returns to wherever the user came from,
 *     restoring the browser's scroll position on the row they clicked).
 *
 * HYDRATION-STABLE: the `from` value is read CLIENT-SIDE only (never
 * useSearchParams, which returns empty on the server → caused a flicker).
 * The first server + client render both show "Back" with no `from`; after
 * mount we upgrade to the link if a `?from=` was present. Both states
 * render the SAME fixed-size control → zero layout shift.
 *
 * SIZE-STABLE: fills the logo slot (mobile top-bar / desktop brand area) so
 * swapping the logo for this button never shifts the page.
 */
export default function JobBackButton() {
  const router = useRouter();
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    // Client-only read — avoids the SSR hydration mismatch entirely.
    setFrom(new URLSearchParams(window.location.search).get("from"));
  }, []);

  const href = from;

  const content = (
    <>
      <ArrowBackIcon fontSize="small" />
      <span className="truncate">Back</span>
    </>
  );

  const classes =
    "inline-flex items-center gap-1.5 h-full max-w-full text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors focus:outline-none";

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={classes}>
      {content}
    </button>
  );
}
