import { getResumeInfo } from "@/app/actions/resume";

import PageHeader from "@/components/PageHeader";
import ResumePanel from "@/components/ResumePanel";
import SubscriptionPanel from "@/components/SubscriptionPanel";
import { getUserEmail } from "@/lib/auth";
import { getEntitlements } from "@/lib/entitlements";
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

  const email = await getUserEmail();
  const entitlements = await getEntitlements(email);

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        subtitle="Manage your resume — the source the AI scores every job against."
      />

      {entitlements && (
        <SubscriptionPanel entitlements={entitlements} />
      )}

      <ResumePanel
        userId={result.userId}
        fileName={result.fileName}
        signedUrl={result.signedUrl}
      />
    </div>
  );
}
