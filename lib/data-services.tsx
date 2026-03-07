import { getUserId } from "./auth";
import { supabase } from "./supabase";

export async function getJobsMatch() {
  const userId = await getUserId();
  if (!userId) return null;

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.error(
      "something wrong when fetching jobs from the server: ",
      error,
    );
  }

  return jobs ?? null;
}
