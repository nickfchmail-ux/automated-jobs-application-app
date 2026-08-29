-- ============================================================
--  usage_counts_by_type.sql
--
--  Server-side aggregate of usage_records per usage_type, used by
--  lib/entitlements.ts getUsageRecords().
--
--  WHY: the old path fetched EVERY usage_records row for the user
--  since the period start (dozens+) just to count 4 usage types in
--  JS. This runs on every consumeEntitlement (search / evaluation /
--  fine-tune) — the full fetch burned rows + RUs. Aggregating in
--  Postgres returns ≤4 rows and lets the (user_id, created_at)
--  index serve the scan.
-- ============================================================

CREATE OR REPLACE FUNCTION usage_counts_by_type(p_user_id uuid, p_since timestamptz)
RETURNS TABLE (usage_type text, n bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT usage_type, count(*)::bigint AS n
  FROM usage_records
  WHERE user_id = p_user_id AND created_at >= p_since
  GROUP BY usage_type;
$$;

REVOKE ALL ON FUNCTION usage_counts_by_type(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION usage_counts_by_type(uuid, timestamptz) TO service_role;
