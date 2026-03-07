import { notFound, redirect } from "next/navigation";

import { getUserId } from "@/lib/auth";
import { BulletList, SectionHeading } from "../_components";
import { getJob } from "../_data";

export const revalidate = 0;

export default async function DetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { job, error } = await getJob(id, userId);
  if (error || !job) notFound();

  const parsedResponsibilities: string[] =
    typeof job.responsibilities === "string"
      ? JSON.parse(job.responsibilities)
      : (job.responsibilities ?? []);

  const parsedRequirements: string[] =
    typeof job.requirements === "string"
      ? JSON.parse(job.requirements)
      : (job.requirements ?? []);

  const parsedBenefits: string[] =
    typeof job.benefits === "string"
      ? JSON.parse(job.benefits)
      : (job.benefits ?? []);

  return (
    <div className="flex flex-col gap-8 overflow-y-scroll max-h-[500px] scroll-smooth">
      {job.short_description && (
        <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6">
          <SectionHeading className="sticky top-0 bg-white dark:bg-zinc-900 py-1 -mx-6 px-6 z-10">
            Job Summary
          </SectionHeading>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {job.short_description}
          </p>

          {parsedResponsibilities.length > 0 && (
            <>
              <br />
              <SectionHeading className="sticky top-0 bg-white dark:bg-zinc-900 py-1 -mx-6 px-6 z-10">
                Responsibilities
              </SectionHeading>
              <BulletList items={parsedResponsibilities} />
            </>
          )}

          {parsedRequirements.length > 0 && (
            <>
              <br />
              <SectionHeading className="sticky top-0 bg-white dark:bg-zinc-900 py-1 -mx-6 px-6 z-10">
                Requirements
              </SectionHeading>
              <BulletList items={parsedRequirements} />
            </>
          )}

          {parsedBenefits.length > 0 && (
            <>
              <br />
              <SectionHeading className="sticky top-0 bg-white dark:bg-zinc-900 py-1 -mx-6 px-6 z-10">
                Benefits
              </SectionHeading>
              <BulletList
                items={parsedBenefits}
                icon={
                  <svg
                    className="w-4 h-4 text-emerald-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                }
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
