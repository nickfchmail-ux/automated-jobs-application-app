"use client";

import { motion, useInView, type Variants } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Shared animation primitives for JobSeek (wraps `motion/react`).
 *
 * Everything respects `prefers-reduced-motion` at the app level
 * (globals.css forces 0.01ms durations) — these just make the default
 * experience feel Stripe-like: restrained, fast, and never janky.
 */

/* ── Variants ─────────────────────────────────────────────────────────── */

/** Fade + slight rise — the default entrance for cards/sections. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

/** Just opacity — for things that should never move (headers, chips). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35, ease: "easeOut" } },
};

/** Scale pop — badges, pills, small elements. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 260, damping: 20 },
  },
};

/* ── Components ──────────────────────────────────────────────────────── */

/**
 * FadeUp — animate a single element into view when it enters the viewport
 * (or immediately if it's already visible). `delay` lets parents stagger
 * children. `as` lets you render a motion element of any tag.
 */
export function FadeUp({
  children,
  delay = 0,
  className,
  as = "div",
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span" | "header" | "p";
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: "-40px" });
  const Comp = motion[as];
  return (
    <Comp
      ref={ref as never}
      initial={{ opacity: 0, y: 12 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      transition={{
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1],
        delay,
      }}
      className={className}
    >
      {children}
    </Comp>
  );
}

/**
 * Stagger — reveals a list of children one after another (nice for stat
 * tiles, pipeline buckets, job cards). Each child is a direct descendant.
 */
export function Stagger({
  children,
  className,
  stagger = 0.06,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
  as?: "div" | "ul" | "section";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const Comp = motion[as];
  return (
    <Comp
      ref={ref as never}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: delay },
        },
      }}
      className={className}
    >
      {children}
    </Comp>
  );
}

/**
 * StaggerItem — a child of <Stagger>. Renders with the shared fadeUp variant.
 */
export function StaggerItem({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "section" | "tr" | "span";
}) {
  const Comp = motion[as];
  return (
    <Comp variants={fadeUp} className={className}>
      {children}
    </Comp>
  );
}

/**
 * AnimatedNumber — counts up (or down) to `value` when it becomes visible.
 * Uses tabular numerals so the digits never jiggle (Stripe data-typography).
 *
 * `format` is a STRING (not a function) so this component stays serializable
 * across the server → client boundary. Options:
 *   - "integer" (default): rounds to a whole number
 *   - "number": compact (1,234 → "1.2k")
 *   - "salary": compact HKD salary ("$5k", "—" for 0)
 */
const NUMBER_FORMATS = {
  integer: (n: number) => String(Math.round(n)),
  number: (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return String(n);
  },
  salary: (n: number) => {
    if (n <= 0) return "—";
    if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
    return `$${String(n)}`;
  },
} as const;

export function AnimatedNumber({
  value,
  className,
  duration = 0.8,
  format = "integer",
}: {
  value: number;
  className?: string;
  duration?: number;
  format?: keyof typeof NUMBER_FORMATS;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const [display, setDisplay] = useState(0);
  const formatFn = NUMBER_FORMATS[format];

  useEffect(() => {
    if (!inView) return;
    let raf: number;
    const start = performance.now();
    const from = 0;
    const to = value;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000));
      // easeOutCubic — fast start, gentle settle
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className ?? ""}`}>
      {formatFn(display)}
    </span>
  );
}

/**
 * SlideTabs — an animated pill indicator (the sliding background) for tab
 * bars. Pass the ACTIVE key; the pill springs to whichever tab is selected
 * via a layout animation. Children are the tab buttons.
 */
export function SlideTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { key: T; label: ReactNode }[];
  active: T;
  onChange: (k: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`relative inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 ${className ?? ""}`}
      role="tablist"
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`relative z-10 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 ${
              isActive
                ? "text-white"
                : "text-[var(--ink-soft)] hover:text-[var(--ink)]"
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={`slide-tab-${t.key}`}
                className="absolute inset-0 -z-10 rounded-lg bg-[var(--accent)]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * AnimatedBar — a client component that renders an animated fill bar inside
 * a track. Safe to use from SERVER components (unlike raw `motion.div`).
 * The bar grows to `width`% when it scrolls into view.
 */
export function AnimatedBar({
  width,
  className,
  trackClassName,
  delay = 0,
  duration = 0.7,
}: {
  width: number;
  className: string;
  trackClassName?: string;
  delay?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-30px" });
  return (
    <div ref={ref} className={`overflow-hidden ${trackClassName ?? ""}`}>
      <motion.div
        className={className}
        initial={{ width: 0 }}
        animate={
          inView
            ? { width: `${Math.max(0, Math.min(100, width))}%` }
            : { width: 0 }
        }
        transition={{ duration, ease: [0.22, 1, 0.36, 1], delay }}
      />
    </div>
  );
}

/**
 * AnimatedTrendBar — a client component for the overview's trend sparkline:
 * a single bar that grows to `height`% when in view. Safe from server pages.
 */
export function AnimatedTrendBar({
  height,
  className,
  delay = 0,
  duration = 0.6,
  title,
  style,
}: {
  height: number;
  className: string;
  delay?: number;
  duration?: number;
  title?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-30px" });
  return (
    <motion.div
      ref={ref}
      title={title}
      className={className}
      style={style}
      initial={{ height: 0 }}
      animate={inView ? { height: `${Math.max(0, height)}%` } : { height: 0 }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1], delay }}
    />
  );
}
