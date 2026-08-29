-- =====================================================================
-- AI Evaluator — atomic fit/not-fit counters on evaluation batches
--
-- The per-keyword batch row (`evaluation_runs`) now carries its OWN
-- fit_jobs / not_fit_jobs counters, bumped ATOMICALLY by the same RPC that
-- bumps processed/failed. This replaces the fragile practice of deriving
-- fit/not-fit by scanning the `jobs` table (which hit Supabase's 1,000-row
-- REST limit, mis-handled keyword normalization, and over/under-counted when
-- a key was matched more than once).
--
-- `increment_evaluation_run` now also accepts the outcome of the job that
-- just finished (fit / not-fit) so concurrent workers never lose a count.
-- =====================================================================

alter table public.evaluation_runs
  add column if not exists fit_jobs int not null default 0,
  add column if not exists not_fit_jobs int not null default 0;

comment on column public.evaluation_runs.fit_jobs is
  'Jobs scored as a FIT in this batch (atomic counter, bumped by workers).';
comment on column public.evaluation_runs.not_fit_jobs is
  'Jobs scored as NOT a fit in this batch (atomic counter, bumped by workers).';

-- Drop and recreate so the new signature (p_fit, p_not_fit) is authoritative.
drop function if exists public.increment_evaluation_run(uuid, int, int, text);

create or replace function public.increment_evaluation_run(
  p_run_id uuid,
  p_processed int,
  p_failed int,
  p_last_error text,
  p_fit int,
  p_not_fit int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_total int;
  v_processed int;
  v_failed int;
  v_fit int;
  v_not_fit int;
begin
  update public.evaluation_runs
  set
    processed_jobs = processed_jobs + coalesce(p_processed, 0),
    failed_jobs    = failed_jobs    + coalesce(p_failed, 0),
    fit_jobs       = fit_jobs       + coalesce(p_fit, 0),
    not_fit_jobs   = not_fit_jobs   + coalesce(p_not_fit, 0),
    last_error     = coalesce(p_last_error, last_error),
    status         = case
                       when status = 'queued' then 'evaluating'
                       else status
                     end
  where id = p_run_id
  returning total_jobs, processed_jobs, failed_jobs, fit_jobs, not_fit_jobs
  into v_total, v_processed, v_failed, v_fit, v_not_fit;

  if not found then
    raise exception 'evaluation run % not found', p_run_id;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'processed', v_processed,
    'failed', v_failed,
    'fit', v_fit,
    'notFit', v_not_fit,
    'done', (v_processed + v_failed) >= v_total
  );
end $$;

comment on function public.increment_evaluation_run(uuid, int, int, text, int, int) is
  'Atomically increment an evaluation batch''s processed/failed/fit/not-fit counts and report whether the batch is complete. Used by the per-job fan-out workers.';
