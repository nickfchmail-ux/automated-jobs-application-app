"use server";

import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

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
    .update({
      applied,
      applied_on: applied
        ? new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Hong_Kong",
          }).format(new Date())
        : null,
    })
    .eq("id", jobId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  return { ok: true, applied };
}

export type ToggleInterestedResult =
  | { ok: true; interested_in: boolean | null }
  | { ok: false; error: string };

export async function toggleInterestedAction(
  jobId: string,
  interestedIn: boolean | null,
): Promise<ToggleInterestedResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Not authenticated." };

  const { error } = await supabase
    .from("jobs")
    .update({ interested_in: interestedIn })
    .eq("id", jobId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/matches");
  return { ok: true, interested_in: interestedIn };
}
