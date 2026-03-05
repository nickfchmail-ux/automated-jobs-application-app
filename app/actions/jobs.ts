"use server";

import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export type ToggleAppliedResult =
  | { ok: true; applied: boolean }
  | { ok: false; error: string };

export async function toggleAppliedAction(
  jobId: string,
  applied: boolean,
): Promise<ToggleAppliedResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const { error } = await supabase
    .from("jobs")
    .update({ applied })
    .eq("id", jobId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, applied };
}
