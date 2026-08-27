"use client";

import { useToast } from "@/components/Toast";
import type { EntitlementSummary } from "@/lib/entitlements-shared";
import { useState, useTransition } from "react";

/**
 * Subscription + usage panel for the Profile page.
 *
 * Shows the user's plan (Free / Standard / Pro / Admin), their current-period
 * usage vs. the plan limits, and buttons to upgrade (Stripe Checkout, choosing
 * Standard or Pro) or manage (Stripe Customer Portal). Live data comes from
 * the server-passed `entitlements` prop (fresh on each profile visit).
 */
export default function SubscriptionPanel({
  entitlements,
}: {
  entitlements: EntitlementSummary;
}) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState<"checkout" | "portal" | null>(null);
  const [tier, setTier] = useState<"standard" | "pro">("standard");

  const { role, plan, limits, usage, subscriptionStatus, planLabel } =
    entitlements;
  const isAdmin = role === "admin";
  const isPaid = plan === "standard" || plan === "pro";

  async function openCheckout() {
    setAction("checkout");
    startTransition(async () => {
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
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

  const statusLabel =
    subscriptionStatus === "active" || subscriptionStatus === "trialing"
      ? "Active"
      : subscriptionStatus === "past_due"
        ? "Past due"
        : subscriptionStatus === "canceled"
          ? "Cancelled"
          : "None";

  const isFreePlan = plan === "free" && !isAdmin;

  // Usage rows. Free plan: 1 search + 1 eval + 1 fine-tune each (lifetime),
  // so every row shows used/max ("1/1"). Paid plans show used/monthly-limit.
  const usageRows = [
    {
      label: isFreePlan ? "Keywords searched" : "Searches",
      used: usage.searches,
      max: isFreePlan ? 1 : limits.monthly.searches,
    },
    {
      label: isFreePlan ? "Keywords evaluated" : "Evaluations",
      used: usage.evaluations,
      max: isFreePlan ? 1 : limits.monthly.evaluations,
    },
    {
      label: "Resume fine-tunes",
      used: usage.fineTuneResume,
      max: limits.monthly.fineTuneResume,
    },
    {
      label: "Cover-letter fine-tunes",
      used: usage.fineTuneCoverLetter,
      max: limits.monthly.fineTuneCoverLetter,
    },
  ];

  const isUnlimitedPlan = limits.unlimited;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Plan</h2>
          <p className="text-xs text-[var(--ink-soft)]">
            Your current plan and usage
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            isAdmin || isPaid
              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent)]/20"
              : "bg-[var(--paper-soft)] text-[var(--ink-soft)] border-[var(--line)]"
          }`}
        >
          {planLabel}
          {isPaid && (
            <span className="font-normal opacity-70">· {statusLabel}</span>
          )}
        </span>
      </div>

      {/* Plan description */}
      <div className="rounded-xl bg-[var(--paper-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
        {isAdmin ? (
          <p>
            You have admin access — unlimited searches, evaluations and
            fine-tuning.
          </p>
        ) : plan === "pro" ? (
          <p>
            You&apos;re on <strong className="text-[var(--ink)]">Pro</strong> —
            70 searches / 70 evaluations / 70 fine-tunes each month, with
            multi-page searches, Indeed, and unlimited results per board.
          </p>
        ) : plan === "standard" ? (
          <p>
            You&apos;re on{" "}
            <strong className="text-[var(--ink)]">Standard</strong> — 30
            searches / 30 evaluations / 30 fine-tunes each month. Single-page
            searches only; Indeed is disabled. Up to 10 results per board per
            search.
          </p>
        ) : (
          <p>
            You&apos;re on the{" "}
            <strong className="text-[var(--ink)]">Free</strong> plan — 1 search
            + 1 evaluation per keyword (lifetime) and 1 fine-tune each. Up to 5
            results per board. Upgrade to Standard or Pro for more.
          </p>
        )}
      </div>

      {/* Usage bars */}
      {!isUnlimitedPlan ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
            {plan === "free" ? "Lifetime usage" : "Usage this period"}
          </p>
          {usageRows.map((row) => {
            const unlimitedMax = row.max === Infinity;
            const pct =
              !unlimitedMax && row.max > 0
                ? Math.min(100, Math.round((row.used / row.max) * 100))
                : 0;
            return (
              <div key={row.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink)]">{row.label}</span>
                  <span className="font-data text-xs text-[var(--ink-soft)] tabular-nums">
                    {unlimitedMax ? "∞" : `${row.used}/${row.max}`}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-[var(--paper-soft)] overflow-hidden">
                  {!unlimitedMax && (
                    <div
                      className={`h-full rounded-full ${
                        pct >= 100 ? "bg-[var(--bad)]" : "bg-[var(--accent)]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {isFreePlan && (
            <p className="text-[11px] text-[var(--ink-faint)]">
              Free plan: 1 search + 1 evaluation per keyword. You can search as
              many different keywords as you like — each one once.
            </p>
          )}
          {isPaid && (
            <p className="text-[11px] text-[var(--ink-faint)]">
              Resets at the start of your next billing cycle.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-faint)]">
          No usage limits on your plan.
        </p>
      )}

      {/* Upgrade / manage actions */}
      {!isAdmin && !isPaid && (
        <div className="space-y-3 pt-1">
          {/* Plan selector */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTier("standard")}
              aria-pressed={tier === "standard"}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                tier === "standard"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:bg-[var(--paper-soft)]"
              }`}
            >
              <p className="text-sm font-semibold text-[var(--ink)]">
                Standard
              </p>
              <p className="text-xs text-[var(--ink-soft)] mt-0.5">
                30 searches · 30 evals · 30 fine-tunes/mo · 10 results/board
              </p>
            </button>
            <button
              onClick={() => setTier("pro")}
              aria-pressed={tier === "pro"}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                tier === "pro"
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:bg-[var(--paper-soft)]"
              }`}
            >
              <p className="text-sm font-semibold text-[var(--ink)]">Pro</p>
              <p className="text-xs text-[var(--ink-soft)] mt-0.5">
                70 searches · 70 evals · 70 fine-tunes/mo · unlimited results
              </p>
            </button>
          </div>
          <button
            onClick={openCheckout}
            disabled={isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-ink)] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm px-4 py-2.5 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            {isPending && action === "checkout"
              ? "Opening checkout…"
              : `Upgrade to ${tier === "pro" ? "Pro" : "Standard"}`}
          </button>
        </div>
      )}

      {isPaid && (
        <button
          onClick={openPortal}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--paper-soft)] disabled:opacity-50 text-sm font-medium px-4 py-2.5 transition-colors"
        >
          {isPending && action === "portal"
            ? "Opening billing…"
            : "Manage subscription"}
        </button>
      )}
    </div>
  );
}
