"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Wraps a server-rendered block in a fade-up entrance animation.
 * Used where a page is a server component but still wants a motion reveal
 * (e.g. the job detail header card).
 */
export default function AnimatedBlock({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
