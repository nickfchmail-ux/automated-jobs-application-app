"use client";
import { logoutAction } from "@/app/actions/auth";
import type { RootState } from "@/state/global/store";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useSelector } from "react-redux";

import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import InsightsIcon from "@mui/icons-material/Insights";
import MenuIcon from "@mui/icons-material/Menu";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";

type NavItem = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
  badge?: number;
};

const LINK_CLASS = {
  base: "flex items-center gap-3 w-full text-sm font-medium px-3 py-2 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  idle: "text-[var(--ink-soft)] hover:bg-[var(--paper-soft)] hover:text-[var(--ink)]",
  active:
    "bg-[var(--accent-soft)] text-[var(--accent-ink)] border border-[var(--line)]",
};

export default function Navbar() {
  // Fit/Not-fit badges hydrate client-side from the aggregate funnel
  // (stats:summary via useRealtimeRun, stored in `run.summary`) so the
  // layout never blocks on Supabase count queries. `run.summary` is kept
  // separate from `run.counts` (the active run's funnel) so the live card
  // never shows lifetime totals.
  const fit = useSelector((s: RootState) => s.run.summary.fit ?? 0);

  const pathName = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A nav item is active when the current path equals its href, or (for /
  // and /overview) when the path is exactly the item's href. /matches is
  // active for /matches?view=notfit too.
  const isActive = (href: string) =>
    pathName === href ||
    (href === "/matches" && pathName.startsWith("/matches"));

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Analyze",
      items: [
        {
          href: "/overview",
          label: "Overview",
          icon: (a) => (
            <InsightsIcon
              className={
                a ? "text-[var(--accent-ink)]" : "text-[var(--ink-faint)]"
              }
            />
          ),
        },
      ],
    },
    {
      label: "Act",
      items: [
        {
          href: "/search",
          label: "Search",
          icon: (a) => (
            <SearchIcon
              className={
                a ? "text-[var(--accent-ink)]" : "text-[var(--ink-faint)]"
              }
            />
          ),
        },
        {
          href: "/review",
          label: "To review",
          icon: (a) => (
            <PendingActionsIcon
              className={
                a ? "text-[var(--accent-ink)]" : "text-[var(--ink-faint)]"
              }
            />
          ),
        },
      ],
    },
    {
      label: "Results",
      items: [
        {
          href: "/matches",
          label: "Matches",
          badge: fit,
          icon: (a) => (
            <TuneIcon
              className={
                a ? "text-[var(--accent-ink)]" : "text-[var(--ink-faint)]"
              }
            />
          ),
        },
      ],
    },
    {
      label: "Account",
      items: [
        {
          href: "/profile",
          label: "Profile",
          icon: (a) => (
            <AssignmentIndIcon
              className={
                a ? "text-[var(--accent-ink)]" : "text-[var(--ink-faint)]"
              }
            />
          ),
        },
      ],
    },
  ];

  function go(href: string) {
    router.push(href);
    setDrawerOpen(false);
  }

  function renderNavItem(item: NavItem, isActive: boolean) {
    return (
      <button
        key={item.label}
        onClick={() => go(item.href)}
        aria-current={isActive ? "page" : undefined}
        className={`${LINK_CLASS.base} ${
          isActive ? LINK_CLASS.active : LINK_CLASS.idle
        }`}
      >
        <span className="w-5 h-5 flex items-center justify-center shrink-0">
          {item.icon(isActive)}
        </span>
        <span className="flex-1 text-left">{item.label}</span>
        {typeof item.badge === "number" && item.badge > 0 && (
          <span className="tabular-nums font-data text-xs font-semibold px-1.5 py-0.5 rounded-full bg-[var(--paper-soft)] text-[var(--ink-soft)]">
            {item.badge}
          </span>
        )}
      </button>
    );
  }

  function renderGroup(label: string, items: NavItem[]) {
    return (
      <div className="space-y-1">
        <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-faint)]">
          {label}
        </p>
        {items.map((item) => renderNavItem(item, isActive(item.href)))}
      </div>
    );
  }

  const signOutButton = (
    <form
      action={async () => {
        await logoutAction();
        router.push("/login");
      }}
    >
      <button
        type="submit"
        className="w-full flex items-center gap-3 text-sm font-medium px-3 py-2 rounded-xl text-zinc-600 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        Sign out
      </button>
    </form>
  );

  const startSearchCta = (
    <button
      onClick={() => go("/search")}
      className="w-full flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-ink)] text-white font-semibold text-sm px-4 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
    >
      <AutoAwesomeIcon className="w-4 h-4" />
      Search &amp; match
    </button>
  );

  const shell = (
    <div className="h-full flex flex-col bg-[var(--surface)] border-r border-[var(--line)]">
      {/* Brand — business logo, full sidebar width */}
      <div className="px-4 pt-5 pb-2">
        <Link href="/overview" className="block shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/JobSeek.png"
            alt="JobSeek"
            className="w-full h-auto max-h-14 object-contain"
          />
        </Link>
      </div>

      {/* CTA */}
      <div className="px-4 pt-3">{startSearchCta}</div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.label}>{renderGroup(g.label, g.items)}</div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3">
        {signOutButton}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-20">
        {shell}
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-[var(--surface)] border-b border-[var(--line)]">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/overview" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white font-bold">
              <span className="text-xs font-display">J</span>
            </div>
            <span className="text-sm font-bold text-[var(--ink)] font-display">
              JobSeek
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go("/search")}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-ink)] text-white text-xs font-semibold px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <AutoAwesomeIcon className="w-3.5 h-3.5" />
              Search
            </button>
            <IconButton
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              sx={{ color: "var(--ink-soft)" }}
            >
              <MenuIcon />
            </IconButton>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: 272,
            bgcolor: "var(--surface)",
          },
        }}
      >
        <div className="relative h-full bg-[var(--surface)]">
          <IconButton
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            sx={{
              position: "absolute",
              top: 12,
              right: 8,
              color: "var(--ink-soft)",
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
          {shell}
        </div>
      </Drawer>
    </>
  );
}
