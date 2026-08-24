import { redirect } from "next/navigation";

export const revalidate = 0;

export const metadata = {
  title: "Overview",
};

/**
 * The root path serves the intelligence dashboard (Overview).
 *
 * The old root page (search + match launcher) moved to /search — the
 * dashboard should show insight, not be a launcher. "/" now redirects to
 * /overview; old bookmarks to "/" land on the insights dashboard, with a
 * clear "Search jobs" CTA.
 */
export default function RootPage() {
  redirect("/overview");
}
