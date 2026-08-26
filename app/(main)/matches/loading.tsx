import RouteLoading from "@/components/RouteLoading";

/** Suspense boundary for /matches — fetches evaluated jobs from Supabase. */
export default function MatchesLoading() {
  return <RouteLoading label="Loading your matches…" />;
}
