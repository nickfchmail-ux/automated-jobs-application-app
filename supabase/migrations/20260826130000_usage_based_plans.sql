-- ============================================================
--  Usage-based plans (Standard / Pro) with monthly reset
--
--  Plan model (HKD/month, IP-localized):
--    free     : lifetime, 1 search + 1 eval per search key, 1 fine-tune each
--    standard : 150 HKD/mo — 30 search / 30 eval / 30 fine-tune each,
--               single-page searches, Indeed DISABLED
--    pro      : 300 HKD/mo — 70 search / 70 eval / 70 fine-tune each,
--               multi-page searches + Indeed ENABLED
--    (admin role via ADMIN_EMAILS = unlimited)
--
--  Monthly reset: `usage_period_start` on profiles marks the start of the
--  current billing period. Usage is counted ONLY within that window
--  (usage_records rows are retained for audit, but only rows with
--  created_at >= usage_period_start count toward the quota).
-- ============================================================

-- ── profiles: add usage_period_start + widen plan check ──────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS usage_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Widen the plan CHECK to include 'standard' and 'pro'.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_plan_check
  CHECK (plan IN ('free', 'standard', 'pro'));
