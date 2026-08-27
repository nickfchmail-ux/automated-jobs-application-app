import { cache } from "react";

import { requireServiceClient } from "@/lib/supabase";

export const getJob = cache(async (id: string, userId: string) => {
  const supabase = requireServiceClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  return { job: job ?? null, error: error ?? null };
});
