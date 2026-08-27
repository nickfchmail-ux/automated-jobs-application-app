-- =====================================================================
-- 20260827120000_hot_path_jobs_indexes.sql
--
-- Supabase exhaustion fix — C4 (Principal Architect review, 2026-08-27)
--
-- The frontend's hottest list queries filter the `jobs` table by:
--   • (user_id, fit) + or(interested_in.is.null, interested_in.eq.true)
--       → /matches fit + not-fit tabs (app/(main)/matches/_view.tsx)
--   • (user_id) + fit_score IS NULL
--       → /review unscored list (app/(main)/review/page.tsx)
--   • pipeline_run_id
--       → live run job stream (hooks/useRealtimeRun.ts hydrate)
--   • (user_id) ordered by created_at desc
--       → getJobsMatch (lib/data-services.tsx)
--
-- The `jobs` table is created/owned by the sibling backend
-- (backend-scraping-api), which already adds single-column indexes
-- (idx_jobs_status, idx_jobs_pipeline_run_id, idx_jobs_fit, …). But there is
-- NO composite index covering (user_id, fit, interested_in) or
-- (user_id, fit_score), so Postgres seq-scans the user's jobs on every list
-- load — a major Supabase exhaustor on accounts with many jobs.
--
-- These CREATE INDEX IF NOT EXISTS statements are additive and safe to run
-- against a backend-owned table. They never modify schema, only add indexes
-- on the exact filter columns the frontend queries use.
-- =====================================================================

-- /matches — fit + not-fit tab lists.
-- Covers the `(user_id, fit)` equality + the `interested_in IS NULL OR = true`
-- OR-branch. Postgres can use the leading (user_id, fit) columns for the
-- equality and still filter interested_in cheaply.
CREATE INDEX IF NOT EXISTS idx_jobs_user_fit_interested
  ON public.jobs (user_id, fit, interested_in);

-- /matches applied-filter + /review.
-- Partial index on unscored jobs keeps the /review "fit_score IS NULL" query
-- to just the rows that match (index-only scan when combined with user_id).
CREATE INDEX IF NOT EXISTS idx_jobs_user_fit_score_null
  ON public.jobs (user_id, fit_score)
  WHERE fit_score IS NULL;

-- getJobsMatch + general "this user's jobs" ordering.
CREATE INDEX IF NOT EXISTS idx_jobs_user_created_at
  ON public.jobs (user_id, created_at DESC);

-- Live run job stream (already has idx_jobs_pipeline_run_id; keep a composite
-- with created_at for the `.order("created_at", {ascending:false}).limit(200)`
-- hydrate query in useRealtimeRun).
CREATE INDEX IF NOT EXISTS idx_jobs_run_created_at
  ON public.jobs (pipeline_run_id, created_at DESC);

-- Verify with:
--   explain analyze
--   select id from jobs
--   where user_id = '<uuid>' and fit = true
--     and (interested_in is null or interested_in = true)
--   order by created_at desc limit 12;
--   → should show Index Scan on idx_jobs_user_fit_interested, NOT Seq Scan.
