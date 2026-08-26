"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * The animated page header — used on every top-level page.
 *
 * Staggers the eyebrow → title → subtitle so pages feel alive on entry
 * (Stripe-style: restrained, fast, nothing slides around forever).
 * `action` is the optional CTA (e.g. "Search jobs →") aligned right.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <motion.header
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
      className="flex flex-col sm:flex-row sm:items-end justify-between gap-6"
    >
      <div>
        <motion.p
          variants={{
            hidden: { opacity: 0, y: 10 },
            visible: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
            },
          }}
          className="eyebrow"
        >
          {eyebrow}
        </motion.p>
        <motion.h1
          variants={{
            hidden: { opacity: 0, y: 14 },
            visible: {
              opacity: 1,
              y: 0,
              transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
            },
          }}
          className="mt-2 text-3xl sm:text-4xl font-display font-semibold tracking-tight text-[var(--ink)]"
        >
          {title}
        </motion.h1>
        {subtitle && (
          <motion.p
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: {
                opacity: 1,
                y: 0,
                transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
              },
            }}
            className="mt-2 text-sm text-[var(--ink-soft)] max-w-xl"
          >
            {subtitle}
          </motion.p>
        )}
      </div>
      {action && (
        <motion.div
          variants={{
            hidden: { opacity: 0, scale: 0.96 },
            visible: {
              opacity: 1,
              scale: 1,
              transition: { duration: 0.35, ease: "easeOut" },
            },
          }}
          className="shrink-0"
        >
          {action}
        </motion.div>
      )}
    </motion.header>
  );
}
