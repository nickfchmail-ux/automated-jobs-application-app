import RouteLoading from "@/components/RouteLoading";

/**
 * Fallback Suspense boundary for the `(main)` route group.
 *
 * Each top-level page (Overview / Search / Matches / Review / Profile) has
 * its OWN `loading.tsx` with a route-specific label. This one is the generic
 * fallback for any nested route that doesn't define its own loader.
 */
export default function MainGroupLoading() {
  return <RouteLoading label="Loading…" />;
}
