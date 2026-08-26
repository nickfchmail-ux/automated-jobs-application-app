"use client";

import { motion } from "motion/react";

/**
 * Full-page loading spinner. A refined motion ring (rotating arc + soft
 * center pulse) — the quiet "loading" signal for server-component suspense.
 * Respects prefers-reduced-motion via the global CSS override.
 */
export default function PageSpinner({
  label = "Loading…",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-4 py-32 text-[var(--ink-faint)]"
    >
      <div className="relative w-10 h-10">
        {/* Soft halo pulse */}
        <motion.span
          className="absolute inset-0 rounded-full bg-[var(--accent-soft)]"
          animate={{ opacity: [0.5, 0.1, 0.5], scale: [1, 1.15, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Rotating arc */}
        <motion.svg
          className="absolute inset-0 w-10 h-10"
          viewBox="0 0 24 24"
          fill="none"
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="9"
            stroke="var(--accent)"
            strokeWidth="2.5"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </motion.svg>
      </div>
      <motion.p
        className="text-sm font-medium text-[var(--ink-soft)]"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        {label}
      </motion.p>
    </div>
  );
}
