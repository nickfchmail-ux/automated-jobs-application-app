"use client";

import { useLayoutEffect } from "react";

const SCROLL_KEY = "jobseek:matches-scroll";

/**
 * Saves the matches page scroll position when the user clicks a job (so
 * going back restores exactly where they were), and restores it when the
 * user returns to /matches from a job detail page.
 *
 * HOW IT WORKS:
 *   - `saveMatchesScrollPosition()` runs right before navigating to a job —
 *     stores window.scrollY in sessionStorage (survives the client-side
 *     navigation within the same tab).
 *   - On mount of /matches, if a saved position exists, we restore it in
 *     `useLayoutEffect` — which fires BEFORE the browser paints. So the page
 *     is rendered already at the saved scroll offset on the very first frame;
 *     the user never sees "top then jump down".
 *
 * Note: the matches list loads under a Suspense boundary. If the content
 * isn't tall enough on the very first paint (skeleton only), the scroll is
 * clamped by the browser. We re-apply after a frame so once the full list is
 * in the DOM the exact offset is restored without a visible jump (the page is
 * already scrolled; we only correct a possible clamp).
 */
export function saveMatchesScrollPosition(): void {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  } catch {
    // non-fatal
  }
}

export function useMatchesScrollRestore(): void {
  useLayoutEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(SCROLL_KEY);
    } catch {
      saved = null;
    }

    // Save the current scroll whenever the user clicks a link that leaves
    // /matches for a job detail page (covers table rows AND JobCard links).
    // Capture-phase so it runs before the navigation.
    const onDocClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement)?.closest?.("a[href^='/jobs/']");
      if (anchor) saveMatchesScrollPosition();
    };
    document.addEventListener("click", onDocClick, true);

    if (saved === null) {
      return () => document.removeEventListener("click", onDocClick, true);
    }

    const y = Number(saved);
    const apply = () => {
      if (!Number.isFinite(y) || y <= 0) return;
      window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior });
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
    };

    // BEFORE paint: land already at the saved offset (no top-then-jump).
    apply();
    // One frame later: correct any clamp from the Suspense skeleton so the
    // exact row is in view (still no visible jump — page is already scrolled).
    const raf = requestAnimationFrame(() => requestAnimationFrame(apply));

    try {
      sessionStorage.removeItem(SCROLL_KEY);
    } catch {
      // non-fatal
    }

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onDocClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

