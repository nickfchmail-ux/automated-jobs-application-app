"use client";

import { useToast } from "@/components/Toast";
import type { EntitlementSummary } from "@/lib/entitlements";
import { useState, useTransition } from "react";

/**
 * Subscription + usage panel for the Profile page.
 *
 * Shows the user's plan (Free / Pro / Admin), their current usage against
 * the free limits, and buttons to upgrade (Stripe Checkout) or manage
 * (Stripe Customer Portal). Live data comes from the server-passed
 * `entitlements` prop (fresh on each profile visit).
 */
export default function SubscriptionPanel({
  entitlements,
}: {
  entitlements: EntitlementSummary;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<"checkout" | "portal" | null>(null);

  const { role, plan, unlimited, usage, subscriptionStatus } = entitlements;
  const isPro = plan === "pro" || role === "admin";

  async function openCheckout() {
    setAction("checkout");
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok || !data?.url) {
          throw new Error(data?.error ?? "Could not start checkout");
        }
        window.location.href = data.url;
      } catch (err) {
        toast.error(
          "Couldn't start checkout",
          err instanceof Error ? err.message : "Please try again.",
        );
      } finally {
        setAction(null);
      }
    });
  }

  async function openPortal() {
    setAction("portal");
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/portal", {
          method: "POST",
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok || !data?.url) {
          throw new Error(data?.error ?? "No subscription to manage");
        }
        window.location.href = data.url;
      } catch (err) {
        toast.error(
          "Couldn't open billing",
          err instanceof Error ? err.message : "Please try again.",
        );
      } finally {
        setAction(null);
      }
    });
  }

  // Build the per-search-key usage list (most recent first).
  const keys = new Set([
    ...Object.keys(usage.searchesByKey),
    ...Object.keys(usage.evaluationsByKey),
  ]);

  const statusLabel =
    subscriptionStatus === "active" || subscriptionStatus === "trialing"
      ? "Active"
      : subscriptionStatus === "past_due"
        ? "Past due"
        : subscriptionStatus === "canceled"
          ? "Cancelled"
          : "None";

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">
            Plan
          </h2>
          <p className="text-xs text-[var(--ink-soft)]">
            Your current plan and usage limits
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            isPro
              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent)]/20"
              : "bg-[var(--paper-soft)] text-[var(--ink-soft)] border-[var(--line)]"
          }`}
        >
          {role === "admin" ? "Admin" : plan === "pro" ? "Pro" : "Free"}
          {plan === "pro" && (
            <span className="font-normal opacity-70">· {statusLabel}</span>
          )}
        </span>
      </div>

      {/* Plan description */}
      <div className="rounded-xl bg-[var(--paper-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
        {role === "admin" ? (
          <p>You have admin access — unlimited searches, evaluations and fine-tuning.</p>
        ) : plan === "pro" ? (
          <p>
            You&apos;re on <strong className="text-[var(--ink)]">Pro</strong> —
            unlimited searches, evaluations and fine-tuning.
          </p>
        ) : (
          <p>
            You&apos;re on the <strong className="text-[var(--ink)]">Free</strong>{" "}
            plan. Unlock unlimited searches, evaluations and fine-tuning with
            Pro.
          </p>
        )}
      </div>

      {/* Usage (free tier only — pro/admin don't have limits) */}
      {!unlimited && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
            Free usage
          </p>

          {/* Per-search-key usage */}
          {keys.size === 0 ? (
            <p className="text-sm text-[var(--ink-faint)]">
              No usage yet — run a search to get started.
            </p>
          ) : (
            <ul className="space-y-2">
              {[...keys].sort().map((k) => {
                const s = usage.searchesByKey[k] ?? 0;
                const e = usage.evaluationsByKey[k] ?? 0;
                return (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="capitalize font-medium text-[var(--ink)] truncate">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="shrink-0 font-data text-xs text-[var(--ink-soft)] tabular-nums">
                      {s}/1 search · {e}/1 evaluation
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Fine-tune usage */}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[var(--ink)]">Resume fine-tune</span>
            <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
              {usage.fineTuneResume}/1
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-[var(--ink)]">Cover-letter fine-tune</span>
            <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
              {usage.fineTuneCoverLetter}/1
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        {plan !== "pro" && role !== "admin" && (
          <button
            onClick={openCheckout}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-ink)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-4 py-2.5 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            {isPending && action === "checkout" ? "Opening checkout…" : "Upgrade to Pro"}
          </button>
        )}
        {plan === "pro" && (
          <button
            onClick={openPortal}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--paper-soft)] disabled:opacity-50 text-sm font-medium px-4 py-2.5 transition-colors"
          >
            {isPending && action === "portal" ? "Opening billing…" : "Manage subscription"}
          </button>
        )}
      </div>
    </div>
  );
}
