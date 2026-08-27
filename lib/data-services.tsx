import { cache } from "react";
import { getUserId } from "./auth";
import { requireServiceClient } from "./supabase";

/**
 * The exact columns the list surfaces (matches / review / job cards) render.
 *
 * ⚠️ DO NOT widen this to `select("*")` — the `jobs` table carries heavy
 * columns (raw_description, cover_letter, responsibilities, requirements,
 * benefits, about_company, fit_reasons, …) that the LIST views never render.
 * Fetching them on every list load was a major Supabase exhaustor (large
 * rows × every job × every page render). The job DETAIL page fetches the
 * full row instead (see app/(main)/jobs/[id]/_data.ts).
 */
export const JOBS_LIST_SELECT =
  "id,title,company,location,salary,url,board,status,short_description,keyword,posted_date,scraped_date,skills,employment_type,experience_level,expected_salary,search_key,created_at,fit,fit_score,applied,applied_on,interested_in,resume_status,resume_url,resume_pdf_url";

/**
 * Per-request memoized fetch of a user's jobs by fit flag (and not-interested
 * exclusion). `React.cache()` dedupes parallel calls in the SAME render — the
 * /matches page fires the fit + not-fit queries together, so this avoids two
 * identical Supabase round-trips when the same (userId, fit) is requested
 * more than once in a single server render. It does NOT cache across
 * requests, so `revalidatePath("/matches")` still shows fresh data.
 */
export const getJobsByFit = cache(
  async (opts: {
    userId: string;
    fit: boolean;
    includeNotInterested?: boolean;
  }): Promise<Record<string, unknown>[] | null> => {
    try {
      const supabase = requireServiceClient();
      let query = supabase
        .from("jobs")
        .select(JOBS_LIST_SELECT)
        .eq("user_id", opts.userId)
        .eq("fit", opts.fit);

      if (opts.includeNotInterested !== false) {
        query = query.or("interested_in.is.null,interested_in.eq.true");
      }

      const { data, error } = await query;
      if (error) {
        console.error(
          `[getJobsByFit:${opts.fit}] Supabase query error:`,
          error,
        );
        return null;
      }
      return (data as Record<string, unknown>[]) ?? null;
    } catch (err) {
      console.error(`[getJobsByFit:${opts.fit}] Unexpected error:`, err);
      return null;
    }
  },
);

export async function getJobsMatch(options?: { limit?: number }) {
  const userId = await getUserId();
  if (!userId) return null;

  const limit = options?.limit ?? 200;

  try {
    const supabase = requireServiceClient();
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select(JOBS_LIST_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[getJobsMatch] Supabase query error:", error);
      return null;
    }

    return jobs ?? null;
  } catch (err) {
    console.error("[getJobsMatch] Unexpected error:", err);
    return null;
  }
}
