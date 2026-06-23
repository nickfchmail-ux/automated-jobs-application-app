import { getUserId } from "./auth";
import { supabase } from "./supabase";

export async function getJobsMatch() {
  const userId = await getUserId();
  if (!userId) return null;

  try {
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId);

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
