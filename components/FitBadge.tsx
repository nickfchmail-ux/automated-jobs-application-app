import { fitBadge } from "@/lib/funnel";

const BUCKET_STYLES: Record<string, string> = {
  great:
    "bg-[var(--good-soft)] text-[var(--good)] border-[color-mix(in_srgb,var(--good)_20%,transparent)]",
  possible:
    "bg-[var(--warn-soft)] text-[var(--warn)] border-[color-mix(in_srgb,var(--warn)_20%,transparent)]",
  low: "bg-[var(--bad-soft)] text-[var(--bad)] border-[color-mix(in_srgb,var(--bad)_20%,transparent)]",
  "not-analysed":
    "bg-[var(--paper-soft)] text-[var(--ink-soft)] border-[var(--line)]",
};

/**
 * Fit badge — color + text (never color alone) for WCAG 1.4.1.
 * Score mapping follows the spec: ≥75 Great fit, 50–74 Possible, <50 Low, null Not analysed.
 */
export default function FitBadge({
  score,
  compact = false,
}: {
  score: number | null | undefined;
  compact?: boolean;
}) {
  const { bucket, badge } = fitBadge(score);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${BUCKET_STYLES[bucket]} ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
    >
      {bucket === "great" && (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      {bucket === "possible" && (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      {bucket === "low" && (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      {bucket === "not-analysed" && (
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )}
      {badge}
    </span>
  );
}
