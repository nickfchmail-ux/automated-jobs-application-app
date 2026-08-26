import RouteLoading from "@/components/RouteLoading";

/** Suspense boundary for /search — the Search + Match panels load async. */
export default function SearchLoading() {
  return <RouteLoading label="Loading search &amp; match…" />;
}
