"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function JobTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const isDetails = pathname.endsWith("/details");

  const tabs = [
    { label: "Analysis", href: `/jobs/${id}/fit`, active: !isDetails },
    { label: "Job Details", href: `/jobs/${id}/details`, active: isDetails },
  ];

  return (
    <nav className="flex border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab.active
              ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
              : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 dark:hover:border-zinc-600"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
