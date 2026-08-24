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
    <div className="max-w-2xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="mt-2 text-3xl font-display font-semibold tracking-tight text-[var(--ink)]">
          Profile
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Manage your resume — the source the AI scores every job against.
        </p>
      </header>

      <ResumePanel
        userId={result.userId}
        fileName={result.fileName}
        signedUrl={result.signedUrl}
      />
    </div>
  );
}
