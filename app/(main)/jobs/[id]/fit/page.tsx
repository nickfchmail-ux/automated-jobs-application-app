import { notFound, redirect } from "next/navigation";

import JobFitCard from "@/components/JobFitCard";
import { getUserId } from "@/lib/auth";
import { getJob } from "../_data";

export const revalidate = 0;

export default async function FitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { job, error } = await getJob(id, userId);
  if (error || !job) notFound();

  const parsedFitReasons: string[] =
    typeof job.fit_reasons === "string"
      ? JSON.parse(job.fit_reasons)
      : (job.fit_reasons ?? []);

  const parsedNotFitReasons: string[] =
    typeof job.not_fit_reasons === "string"
      ? JSON.parse(job.not_fit_reasons || "[]")
      : (job.not_fit_reasons ?? []);

  return (
    <JobFitCard
      initialFit={job.fit ?? null}
      initialFitScore={job.fit_score}
      initialFitReasons={parsedFitReasons}
      initialNotFitReasons={parsedNotFitReasons}
      initialJustification={job.justification ?? null}
    />
  );
}
