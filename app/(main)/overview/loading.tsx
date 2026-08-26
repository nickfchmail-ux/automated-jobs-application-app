import RouteLoading from "@/components/RouteLoading";

/** Suspense boundary for /overview — fetches insights from the backend. */
export default function OverviewLoading() {
  return <RouteLoading label="Loading your insights…" />;
}
