import Navbar from "@/components/Navbar";
import ProviderManager from "@/components/ProviderManager";

/**
 * Main layout for authenticated routes.
 *
 * Intentionally does NOT block the render on Supabase count queries — the
 * navbar badges hydrate client-side from the Redux store (via
 * `useRealtimeRun` → `stats:summary`), so the page shell (Search, Match,
 * RunHistory) paints immediately instead of waiting on backend queries.
 */
export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProviderManager>
      <Navbar />
      <div className="lg:pl-64">{children}</div>
    </ProviderManager>
  );
}
