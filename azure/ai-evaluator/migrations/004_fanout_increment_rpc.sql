-- =====================================================================
-- AI Evaluator — per-job fan-out support
--
-- The evaluator now enqueues ONE Service Bus message per job post. Each
-- worker increments its batch's progress via an ATOMIC RPC so concurrent
-- workers can never lose an update (a naive read-modify-write would race).
--
-- `increment_evaluation_run` atomically bumps processed/failed and returns
-- the post-update totals + whether the batch is now finished. The LAST
-- worker to finish sees `done = true` and is responsible for marking the
-- pipeline run(s) complete.
-- =====================================================================

create or replace function public.increment_evaluation_run(
  p_run_id uuid,
  p_processed int,
  p_failed int,
  p_last_error text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_total int;
  v_processed int;
  v_failed int;
begin
  update public.evaluation_runs
  set
    processed_jobs = processed_jobs + coalesce(p_processed, 0),
    failed_jobs   = failed_jobs   + coalesce(p_failed, 0),
    last_error    = coalesce(p_last_error, last_error),
    status        = case
                      when status = 'queued' then 'evaluating'
                      else status
                    end
  where id = p_run_id
  returning total_jobs, processed_jobs, failed_jobs
  into v_total, v_processed, v_failed;

  if not found then
    raise exception 'evaluation run % not found', p_run_id;
  end if;

  return jsonb_build_object(
    'total', v_total,
    'processed', v_processed,
    'failed', v_failed,
    'done', (v_processed + v_failed) >= v_total
  );
end $$;

comment on function public.increment_evaluation_run(uuid, int, int, text) is
  'Atomically increment an evaluation batch''s processed/failed counts and report whether the batch is complete. Used by the per-job fan-out workers.';
