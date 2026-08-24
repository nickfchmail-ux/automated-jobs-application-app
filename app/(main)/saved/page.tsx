import FitFilters from "@/components/FitFilters";
import type { Job } from "@/components/JobCard";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata: Metadata = {
  title: "Saved",
};

/**
 * /saved — jobs the user marked as not interested / saved for later.
 *
 * Replaces the old /not-interested page with clearer naming.
 */
export default async function SavedPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let jobs: Job[] = [];
  try {
    const result = await supabase
      .from("jobs")
      .select("*")
      .eq("interested_in", false)
      .eq("user_id", userId);

    if (result.error) {
      console.error("[SavedPage] Supabase query error:", result.error);
    } else {
      jobs = (result.data as Job[]) ?? [];
    }
  } catch (err) {
    console.error("[SavedPage] Unexpected error fetching jobs:", err);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10 space-y-8">
      <header>
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 text-3xl font-display font-semibold tracking-tight text-[var(--ink)]">
          Saved for later
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)] max-w-xl">
          Jobs you&apos;ve set aside. They won&apos;t appear in your matches.
        </p>
      </header>

      <FitFilters
        jobs={jobs}
        emptyMessage="Nothing saved yet. Mark a job as not interested to keep it here."
      />
    </div>
  );
}
