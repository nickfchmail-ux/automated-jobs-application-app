-- ============================================================
--  Per-user entitlements ledger (allowed vs used counters)
--
--  A SINGLE row per user that records the plan's privileges as
--  concrete numbers:
--    allowed_*   — how many of each action the current plan grants
--    used_*      — how many have been consumed in the current period
--
--  Lifecycle:
--    - Created at account signup (defaults to the Free plan).
--    - On plan purchase (Stripe webhook) the allowed_* counts are
--      updated to the new plan's limits AND used_* is reset to 0.
--    - Every backend consume (search / evaluate / fine-tune) bumps
--      the matching used_* counter; a refund decrements it.
--
--  This is a denormalized, fast-read ledger. The historical
--  `usage_records` audit rows remain the source of truth for
--  per-key free limits + billing-period reconciliation.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.entitlements (
  user_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL DEFAULT 'free'
                        CHECK (plan IN ('free', 'standard', 'pro')),
  -- Allowed (privileges granted by the current plan)
  allowed_searches          INTEGER NOT NULL DEFAULT 0,
  allowed_evaluations       INTEGER NOT NULL DEFAULT 0,
  allowed_fine_tune_resume  INTEGER NOT NULL DEFAULT 0,
  allowed_fine_tune_cover   INTEGER NOT NULL DEFAULT 0,
  -- Used (consumed in the current period)
  used_searches             INTEGER NOT NULL DEFAULT 0,
  used_evaluations          INTEGER NOT NULL DEFAULT 0,
  used_fine_tune_resume     INTEGER NOT NULL DEFAULT 0,
  used_fine_tune_cover      INTEGER NOT NULL DEFAULT 0,
  -- Period bookkeeping
  period_started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_ends_at        TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by plan (e.g. bulk admin queries).
CREATE INDEX IF NOT EXISTS idx_entitlements_plan ON public.entitlements (plan);

-- ── RLS: users can read/update only their OWN entitlements row ──
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own entitlements" ON public.entitlements;
CREATE POLICY "Users select own entitlements"
  ON public.entitlements FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own entitlements" ON public.entitlements;
CREATE POLICY "Users update own entitlements"
  ON public.entitlements FOR UPDATE USING (auth.uid() = user_id);

-- ── updated_at trigger ────────────────────────────────────────
DROP TRIGGER IF EXISTS entitlements_updated_at ON public.entitlements;
CREATE TRIGGER entitlements_updated_at
  BEFORE UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RPC: atomically bump a used_* counter (backend consume/refund) ──
-- Dynamically references the column by name so one function serves all four
-- counters. `p_delta` defaults to +1 (a consume); pass -1 to refund.
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
  EXECUTE format(
    'UPDATE public.entitlements
       SET %s = GREATEST(0, %s + $1), updated_at = NOW()
       WHERE user_id = $2',
    _col, _col
  ) USING p_delta, p_user_id;
  -- Lazy create if the row doesn't exist yet (default free plan).
  IF NOT FOUND THEN
    INSERT INTO public.entitlements (user_id, plan, period_started_at)
    VALUES (p_user_id, 'free', NOW());
    EXECUTE format(
      'UPDATE public.entitlements
         SET %s = GREATEST(0, %s + $1), updated_at = NOW()
         WHERE user_id = $2',
      _col, _col
    ) USING p_delta, p_user_id;
  END IF;
END;
$$;

-- Grant service-role (and the app role) execute.
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bump_entitlement(UUID, TEXT, INTEGER) TO anon;
