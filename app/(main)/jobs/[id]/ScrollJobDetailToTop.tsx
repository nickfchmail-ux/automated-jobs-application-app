"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Ensures the page opens at the TOP on every route change to a job detail
 * page. Next.js App Router preserves scroll position across client-side
 * navigations (designed for back/forward restore), which means clicking a
 * job card/row from a scrolled matches list loads the detail page mid-scroll
 * — that's the "shift" users see.
 *
 * WHY MULTIPLE PASSES: a plain `useEffect` scrollTo fires BEFORE Next.js's
 * router re-applies the preserved scroll position, so a single scrollTo gets
 * overwritten. We therefore scroll immediately, again on the next two
 * animation frames (after Next's restore), and once more after a short delay
 * to catch content that loads after the route settles (Supabase-driven
 * sections add height and can push the viewport back down). Back/forward
 * (popstate) is untouched — this only forces top on forward nav.
 */
export default function ScrollJobDetailToTop() {
  const pathname = usePathname();

  useEffect(() => {
    // Only job detail pages (e.g. /jobs/[id] or /jobs/[id]/details|fit).
    if (!pathname?.startsWith("/jobs/")) return;

    const toTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
      // Also reset any scrollable ancestor in case the layout scrolls a
      // container (mobile top bar / drawer) rather than the window.
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    // First pass now, then two frames later to beat Next's scroll restore.
    toTop();
    const raf1 = requestAnimationFrame(() => {
      toTop();
      requestAnimationFrame(toTop);
    });

    // Late pass: catch content that loads after the route settles (e.g. the
    // Supabase-driven resume/cover-letter sections adding page height).
    const t1 = window.setTimeout(toTop, 120);
    const t2 = window.setTimeout(toTop, 400);

    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pathname]);

  return null;
}
