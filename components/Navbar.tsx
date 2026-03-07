"use client";
import { logoutAction } from "@/app/actions/auth";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import SentimentVeryDissatisfiedIcon from "@mui/icons-material/SentimentVeryDissatisfied";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import Badge from "@mui/material/Badge";
import BackButton from "./BackButton";
import TransparentButton from "./TransparentButton";

type Props = {
  currentPath?: string;
  fit?: number;
  notFit?: number;
};

export default function Navbar({ currentPath = "/", fit, notFit }: Props) {
  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/fit", label: "Good Fit" },
    { href: "/not-fit", label: "Not Fit" },
    { href: "/profile", label: "Profile" },
  ];

  const pathName = usePathname();
  const router = useRouter();

  return (
    <nav className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10 h-[max-content] ">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between gap-4 h-full py-5">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className={`mt-2 ml-2  w-min-[max-content]`}>
            <BackButton />
          </div>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1 flex-wrap justify-around">
          {links.map((link) => {
            const isActive = pathName === link.href;
            const shouldShowBadge =
              link.label === "Good Fit" || link.label === "Not Fit";
            return (
              <TransparentButton
                key={link.label}
                icon={
                  shouldShowBadge ? (
                    <Badge
                      badgeContent={link.label === "Good Fit" ? fit : notFit}
                      color="primary"
                    >
                      {link.label === "Good Fit" && (
                        <SentimentSatisfiedAltIcon color="primary" />
                      )}

                      {link.label === "Not Fit" && (
                        <SentimentVeryDissatisfiedIcon color="error" />
                      )}
                    </Badge>
                  ) : link.label === "Dashboard" ? (
                    <SpaceDashboardIcon color="secondary" />
                  ) : (
                    <AssignmentIndIcon color="info" />
                  )
                }
                isActive={isActive}
                iconPosition={shouldShowBadge ? "right" : "left"}
                title={link.label}
                onClick={() => router.push(link.href)}
              />
            );
          })}
        </div>

        {/* Logout */}
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950 "
          >
            <svg
              className="w-3.5 h-3.5"
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
      </div>
    </nav>
  );
}
