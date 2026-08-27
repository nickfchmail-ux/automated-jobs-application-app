"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Ensures the page opens at the TOP on every route change to a job detail
 * page. Next.js App Router preserves scroll position across client-side
 * navigations (designed for back/forward restore), which means clicking a
 * job row from a scrolled matches list loads the detail page mid-scroll —
 * that's the "shift" users see. This forces a scroll-to-top on forward
 * navigation while leaving browser back/forward restoration intact.
 */
export default function ScrollJobDetailToTop() {
  const pathname = usePathname();

  useEffect(() => {
    // Only job detail pages (e.g. /jobs/[id] or /jobs/[id]/details|fit).
    if (!pathname?.startsWith("/jobs/")) return;
    // Scroll instantly (no smooth) so the page never visibly "slides".
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    // Also reset any scrollable ancestor in case the layout scrolls a
    // container (mobile top bar / drawer) rather than the window.
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);

  return null;
}
