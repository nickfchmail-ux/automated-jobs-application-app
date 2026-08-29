-- ============================================================
--  list_unevaluated_keys.sql
--
--  Server-side aggregation for the Match dropdown ("search keys
--  with unevaluated posts").
--
--  WHY
--  ---
--  The old client path did `SELECT search_key, fit_score,
--  pipeline_run_id FROM jobs WHERE user_id = $1 AND status <>
--  'duplicate' AND fit_score IS NULL` — pulling EVERY unevaluated
--  row (hundreds) to the server action just to count per key.
--  On a busy/degraded Supabase this full row-fetch is slow and
--  burns RUs. Aggregating in Postgres returns a handful of rows
--  (one per key) and lets the (user_id, fit_score) partial index
--  serve the scan.
--
--  Returns one row per search_key that still has unevaluated
--  posts, with the count and a valid runId to evaluate under.
-- ============================================================

CREATE OR REPLACE FUNCTION list_unevaluated_keys(p_user_id uuid)
RETURNS TABLE (
  search_key text,
  unevaluated bigint,
  total bigint,
  run_id uuid
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    lower(trim(coalesce(j.search_key, ''))) AS search_key,
    count(*) FILTER (WHERE j.fit_score IS NULL)::bigint AS unevaluated,
    count(*)::bigint AS total,
    -- Any run that has an unevaluated job under this key (for evaluation
    -- context). Prefer the most recent.
    (array_agg(j.pipeline_run_id ORDER BY j.created_at DESC)
       FILTER (WHERE j.pipeline_run_id IS NOT NULL))[1] AS run_id
  FROM jobs j
  WHERE j.user_id = p_user_id
    AND j.status <> 'duplicate'
  GROUP BY 1
  HAVING count(*) FILTER (WHERE j.fit_score IS NULL) > 0
  ORDER BY unevaluated DESC, total DESC;
$$;

REVOKE ALL ON FUNCTION list_unevaluated_keys(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_unevaluated_keys(uuid) TO service_role;
