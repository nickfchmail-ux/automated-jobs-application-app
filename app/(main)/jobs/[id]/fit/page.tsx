import { notFound, redirect } from "next/navigation";

import { getUserId } from "@/lib/auth";
import { SectionHeading } from "../_components";
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

  const parsedReasons: string[] =
    typeof job.fit_reasons === "string"
      ? JSON.parse(job.fit_reasons)
      : (job.fit_reasons ?? []);

  if (!parsedReasons.length) {
    return (
      <p className="text-sm text-zinc-400 dark:text-zinc-600">
        No fit analysis available.
      </p>
    );
  }
  console.log(job);
  return (
    <section
      className={`rounded-2xl border p-6 ${
        job.fit
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50"
          : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50"
      }`}
    >
      <SectionHeading>
        {job.fit ? "Why it's a good fit" : "Why it doesn't fit"}
      </SectionHeading>
      <ul className="space-y-3">
        {parsedReasons.map((reason, i) => (
          <li
            key={i}
            className="flex gap-3 text-sm text-zinc-700 dark:text-zinc-300"
          >
            <span
              className={`mt-0.5 shrink-0 text-base leading-none ${job.fit ? "text-emerald-500" : "text-red-400"}`}
            >
              {job.fit ? "✓" : "✗"}
            </span>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
