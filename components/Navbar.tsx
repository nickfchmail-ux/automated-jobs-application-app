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
import GppBadOutlinedIcon from "@mui/icons-material/GppBadOutlined";
import ListAltIcon from "@mui/icons-material/ListAlt";
import MenuIcon from "@mui/icons-material/Menu";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import SickOutlinedIcon from "@mui/icons-material/SickOutlined";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";

type NavItem = {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
  badge?: number;
};

const LINK_CLASS = {
  base: "flex items-center gap-3 w-full text-sm font-medium px-3 py-2 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
  idle: "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:text-zinc-900 dark:hover:text-zinc-100",
  active:
    "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800",
};

export default function Navbar() {
  // Fit/Not-fit badges hydrate client-side from the live funnel counts
  // (stats:summary via useRealtimeRun) so the layout never blocks on
  // Supabase count queries.
  const fit = useSelector((s: RootState) => s.run.counts.fit ?? 0);
  const notFit = useSelector((s: RootState) => s.run.counts.unfit ?? 0);

  const pathName = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Overview",
      items: [
        {
          href: "/",
          label: "Dashboard",
          icon: (a) => (
            <SpaceDashboardIcon
              className={
                a ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"
              }
            />
          ),
        },
      ],
    },
    {
      label: "Browse",
      items: [
        {
          href: "/jobs",
          label: "All Jobs",
          icon: (a) => (
            <ListAltIcon
              className={
                a ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"
              }
            />
          ),
        },
        {
          href: "/not-evaluated",
          label: "To Review",
          icon: (a) => (
            <PendingActionsIcon
              className={
                a ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"
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
          href: "/fit",
          label: "Good Fit",
          badge: fit,
          icon: (a) => (
            <SentimentSatisfiedAltIcon
              className={
                a
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }
            />
          ),
        },
        {
          href: "/not-fit",
          label: "Not Fit",
          badge: notFit,
          icon: (a) => (
            <GppBadOutlinedIcon
              className={
                a
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-rose-500 dark:text-rose-400"
              }
            />
          ),
        },
        {
          href: "/not-interested",
          label: "Skipped",
          icon: (a) => (
            <SickOutlinedIcon
              className={
                a ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"
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
                a ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500"
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
          <span className="tabular-nums text-xs font-semibold px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
            {item.badge}
          </span>
        )}
      </button>
    );
  }

  function renderGroup(label: string, items: NavItem[]) {
    return (
      <div className="space-y-1">
        <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {label}
        </p>
        {items.map((item) => renderNavItem(item, pathName === item.href))}
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

  const startMatchingCta = (
    <button
      onClick={() => go("/evaluate")}
      className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm px-4 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <AutoAwesomeIcon className="w-4 h-4" />
      Start matching
    </button>
  );

  const shell = (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
      {/* Brand */}
      <div className="px-4 pt-5 pb-2">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold">
            <span className="text-sm">J</span>
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 font-display">
              JobSeek
            </p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Smart careers, simplified by AI
            </p>
          </div>
        </Link>
      </div>

      {/* CTA */}
      <div className="px-4 pt-3">{startMatchingCta}</div>

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
      <header className="lg:hidden sticky top-0 z-30 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">
              <span className="text-xs">J</span>
            </div>
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 font-display">
              JobSeek
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {startMatchingCta && (
              <button
                onClick={() => go("/evaluate")}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <AutoAwesomeIcon className="w-3.5 h-3.5" />
                Start matching
              </button>
            )}
            <IconButton
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              sx={{ color: "var(--color-zinc-600)" }}
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
            bgcolor: "var(--color-zinc-900, #fff)",
          },
        }}
      >
        <div className="relative h-full bg-white dark:bg-zinc-900">
          <IconButton
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation menu"
            sx={{
              position: "absolute",
              top: 12,
              right: 8,
              color: "var(--color-zinc-500)",
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
