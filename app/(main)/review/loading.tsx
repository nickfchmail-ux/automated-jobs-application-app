import RouteLoading from "@/components/RouteLoading";

/** Suspense boundary for /review — fetches unscored jobs from Supabase. */
export default function ReviewLoading() {
  return <RouteLoading label="Loading jobs to review…" />;
}
