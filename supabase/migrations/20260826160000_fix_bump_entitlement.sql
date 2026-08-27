-- ============================================================
--  Fix bump_entitlement RPC (identifier double-quoting bug)
--
--  The original migration used `format('... %I ...', _col)` where _col was
--  ALREADY quote_ident()'ed — %I quoted it a second time, producing a
--  mangled identifier ("\"used_searches\"") so the UPDATE silently failed
--  and the entitlements ledger never incremented. Use %s with the already
--  quoted identifier instead.
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
  -- counter. GREATEST(0, ...) keeps the counter non-negative. This does NOT
  -- depend on PL/pgSQL FOUND (which is unreliable when the value doesn't
  -- change), so a decrement of 0 → 0 or a bump on a fresh row always works.
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

-- Re-grant (harmless).
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO anon;
