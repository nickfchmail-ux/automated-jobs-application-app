"use client";

import { motion } from "motion/react";

/**
 * Animated "dot dot dot" loading indicator (3rd-party `motion` library).
 *
 * Three dots that pulse/stagger — the friendly "generating…" signal used by
 * the resume + cover letter cards while a document is being built.
 * Respects `prefers-reduced-motion` (the animation becomes static).
 */
export default function DotLoader({
  className = "",
  dotClassName = "",
}: {
  className?: string;
  dotClassName?: string;
}) {
  const dot = `w-1.5 h-1.5 rounded-full ${dotClassName}`;

  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      aria-label="Generating"
      role="status"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className={dot}
          animate={{ opacity: [0.25, 1, 0.25], scale: [0.85, 1.15, 0.85] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut",
          }}
        />
      ))}
    </span>
  );
}
