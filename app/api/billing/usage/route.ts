import { getEntitlements } from "@/lib/entitlements";
import { NextResponse } from "next/server";

/**
 * GET /api/billing/usage
 *
 * Returns the current user's entitlement summary (plan, role, and usage vs.
 * free limits) so the UI can show quotas and upgrade prompts. Scoped to the
 * authenticated user; never leaks another user's data.
 */
export async function GET() {
  const entitlements = await getEntitlements();
  if (!entitlements) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ entitlements });
}
