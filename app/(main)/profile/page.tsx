import { getResumeInfo } from "@/app/actions/resume";

import ResumePanel from "@/components/ResumePanel";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const result = await getResumeInfo();

  if (!result.ok) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">


      {/* Page header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 sm:px-8 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Profile
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Manage your resume for automated applications
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 sm:px-8 py-8">
        <ResumePanel
          userId={result.userId}
          fileName={result.fileName}
          signedUrl={result.signedUrl}
        />
      </main>
    </div>
  );
}
