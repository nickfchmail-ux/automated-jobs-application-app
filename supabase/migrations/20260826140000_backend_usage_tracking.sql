-- ============================================================
--  Authoritative server-side usage tracking (backend enforcement)
--
--  The backend Azure Functions (scrape / evaluate / generateDocument)
--  are now the SINGLE WRITER of `usage_records` — they enforce the
--  plan limits and deduct usage when an action actually runs.
--
--  Changes:
--    1. Add `plan` column to usage_records (the plan that was active
--       when the usage was consumed) so we can enforce free per-key
--       limits with a PARTIAL unique index.
--    2. Replace the FULL unique index on (user_id, usage_type, search_key)
--       with a PARTIAL one (WHERE plan = 'free'). Free users get at most
--       ONE search + ONE evaluation per key (lifetime); paid users may
--       re-search the same keyword to advance to the next page, so they
--       are allowed multiple rows per (type, key).
--    3. Keep the (user_id, usage_type) index for monthly counting.
-- ============================================================

-- ── 1. Add `plan` column ─────────────────────────────────────
ALTER TABLE public.usage_records
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'standard', 'pro', 'admin'));

-- ── 2. Replace the full unique index with a partial (free-only) ──
DROP INDEX IF EXISTS idx_usage_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_free_dedup
  ON public.usage_records (user_id, usage_type, search_key)
  WHERE plan = 'free';

-- ── 3. Keep the monthly-count index ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_usage_user_type
  ON public.usage_records (user_id, usage_type);
