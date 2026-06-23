import Navbar from "@/components/Navbar";
import ProviderManager from "@/components/ProviderManager";
import { getUserId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getUserId();

  let fit = 0;
  let notFit = 0;

  if (userId) {
    try {
      const results = await Promise.all([
        supabase
          .from("jobs")
          .select("*", { count: "exact", head: true })
          .eq("fit", true)
          .eq("user_id", userId)
          // (applied IS NULL OR applied = false) AND (interested_in IS NULL OR interested_in = true)
          // => distributive expansion via and() inside or()
          .or(
            "and(applied.is.null,interested_in.is.null)," +
            "and(applied.is.null,interested_in.eq.true)," +
            "and(applied.eq.false,interested_in.is.null)," +
            "and(applied.eq.false,interested_in.eq.true)",
          ),
        supabase
          .from("jobs")
          .select("*", { count: "exact", head: true })
          .eq("fit", false)
          .eq("user_id", userId),
      ]);

      const fitResult = results[0];
      const notFitResult = results[1];

      if (fitResult.error) {
        console.error("[MainLayout] fit count query error:", fitResult.error);
      }
      if (notFitResult.error) {
        console.error("[MainLayout] notFit count query error:", notFitResult.error);
      }

      fit = fitResult.count ?? 0;
      notFit = notFitResult.count ?? 0;
    } catch (err) {
      console.error("[MainLayout] Unexpected error fetching counts:", err);
    }
  }

  return (
    <ProviderManager>
      <Navbar fit={fit} notFit={notFit} />
      {children}
    </ProviderManager>
  );
}
