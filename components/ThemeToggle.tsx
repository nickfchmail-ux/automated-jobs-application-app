"use client";

import { useTheme } from "@/app/theme-provider";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Sun/moon toggle. Sits in the navbar (desktop sidebar footer + mobile top
 * bar). The icon cross-fades + rotates so switching feels instant but alive.
 *
 * IMPORTANT (hydration safety): the icon is NOT rendered until the component
 * has mounted on the client. During SSR + hydration the theme may differ
 * between server (always "light") and client (whatever the user saved), so
 * rendering the sun/moon immediately would make React hydrate a different
 * DOM subtree (two different <path>s) — which can trip framer-motion's
 * internal hooks and throw React error #310. Rendering a neutral placeholder
 * until mount keeps SSR/client DOM identical, then swaps in the real icon.
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && theme === "dark";

  return (
    <motion.button
      type="button"
      onClick={toggleTheme}
      whileTap={{ scale: 0.9 }}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex items-center justify-center w-9 h-9 rounded-xl text-[var(--ink-soft)] hover:bg-[var(--paper-soft)] hover:text-[var(--ink)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <motion.span
        key={mounted ? (dark ? "moon" : "sun") : "placeholder"}
        initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }}
        className="flex"
      >
        {!mounted ? (
          /* Neutral placeholder during SSR/hydration — same size as the icons
             so the button doesn't shift when the real icon mounts. */
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <circle cx="12" cy="12" r="9" strokeDasharray="1.5 3" />
          </svg>
        ) : dark ? (
          /* Moon */
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
            />
          </svg>
        ) : (
          /* Sun */
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        )}
      </motion.span>
    </motion.button>
  );
}
