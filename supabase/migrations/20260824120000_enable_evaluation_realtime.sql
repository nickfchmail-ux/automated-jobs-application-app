-- =====================================================================
-- AI Evaluator — enable Realtime for evaluation_runs
--
-- The frontend subscribes to `evaluation_runs` via Supabase Realtime to
-- show per-keyword batch progress live (see hooks/useRealtimeRun.ts). The
-- table was never added to the supabase_realtime publication, so batch
-- progress silently never streamed to the browser.
--
-- Also ensure `pipeline_runs` is published so evaluation_status changes
-- stream (the backend's 0003_realtime.sql adds jobs + pipeline_runs, but
-- this is idempotent).
-- =====================================================================

-- Ensure the realtime publication exists (matching backend 0003_realtime.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

-- Idempotently add a table to the realtime publication if it isn't already
-- a member (ALTER PUBLICATION ... ADD TABLE errors if it's already there,
-- which breaks re-runs — e.g. pipeline_runs/jobs are added by the backend's
-- 0003_realtime.sql).
create or replace function public.realtime_add_table(tbl text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
  ) then
    execute format('alter publication supabase_realtime add table public.%I', tbl);
  end if;
end $$;

-- evaluation_runs → per-keyword batch progress (frontend EvaluationProgress).
select public.realtime_add_table('evaluation_runs');

-- pipeline_runs → evaluation_status transitions (frontend evaluationStatus).
select public.realtime_add_table('pipeline_runs');

-- jobs → fit / fit_score / resume_status updates (frontend job stream).
select public.realtime_add_table('jobs');

-- Clean up the helper (keep the migration surface minimal).
drop function public.realtime_add_table(text);

-- Verify with:
--   select tablename from pg_publication_tables where pubname='supabase_realtime';
