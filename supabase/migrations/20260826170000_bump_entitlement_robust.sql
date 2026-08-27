-- ============================================================
--  Make bump_entitlement robust (atomic upsert, no FOUND reliance)
--
--  The previous fix corrected identifier quoting but still used
--  `UPDATE ... IF NOT FOUND THEN INSERT`, which breaks when the UPDATE
--  matches a row but the value doesn't change (decrement 0→0) — PL/pgSQL
--  reports FOUND=false and then INSERT hits the PK duplicate.
--  Replace with a single INSERT ... ON CONFLICT DO UPDATE.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bump_entitlement(
  p_user_id UUID,
  p_column TEXT,
  p_delta INTEGER DEFAULT 1
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _col TEXT;
BEGIN
  -- Whitelist the allowed column names (never trust caller input).
  IF p_column NOT IN (
    'used_searches','used_evaluations',
    'used_fine_tune_resume','used_fine_tune_cover'
  ) THEN
    RAISE EXCEPTION 'invalid entitlement column';
  END IF;
  _col := quote_ident(p_column);
  -- Atomic upsert: create a default free row if absent, then bump the
  -- counter. GREATEST(0, ...) keeps the counter non-negative. Does NOT
  -- depend on PL/pgSQL FOUND, so decrementing 0 → 0 and fresh-row bumps
  -- always work.
  EXECUTE format(
    'INSERT INTO public.entitlements (user_id, plan, period_started_at)
       VALUES ($1, ''free'', NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET %s = GREATEST(0, public.entitlements.%s + $2),
           updated_at = NOW()',
    _col, _col
  ) USING p_user_id, p_delta;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO anon;
