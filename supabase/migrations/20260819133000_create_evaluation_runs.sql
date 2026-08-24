-- =====================================================================
-- AI Evaluator — Supabase migration
-- Adds the evaluation_runs table (per-keyword batch status) and an
-- evaluation_status column on pipeline_runs, plus indexes + RLS.
--
-- Run this in the Supabase SQL editor (or via migrations).
-- =====================================================================

-- 1. evaluation_runs — one row per keyword batch per run.
create table if not exists public.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline_run_id uuid not null references public.pipeline_runs (id) on delete cascade,
  user_id uuid not null,
  keyword text not null default 'general',
  status text not null default 'queued'
    check (status in ('queued', 'evaluating', 'completed', 'failed')),
  total_jobs integer not null default 0,
  processed_jobs integer not null default 0,
  failed_jobs integer not null default 0,
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.evaluation_runs is
  'AI evaluation progress per keyword batch. The evaluator microservice creates '
  'one row per batch when evaluation starts and updates it as the batch runs.';

-- 2. pipeline_runs.evaluation_status — overall evaluation state for a run.
alter table public.pipeline_runs
  add column if not exists evaluation_status text
    check (evaluation_status in ('none', 'queued', 'evaluating', 'completed', 'failed'))
    default 'none';

comment on column public.pipeline_runs.evaluation_status is
  'Overall AI evaluation state for the run: none → queued → evaluating → completed / failed.';

-- 3. Indexes for the hot query paths.
create index if not exists evaluation_runs_pipeline_run_id_idx
  on public.evaluation_runs (pipeline_run_id);
create index if not exists evaluation_runs_user_id_idx
  on public.evaluation_runs (user_id);
create index if not exists evaluation_runs_keyword_idx
  on public.evaluation_runs (keyword);
create index if not exists jobs_pipeline_run_id_status_idx
  on public.jobs (pipeline_run_id, status);

-- 4. Row Level Security — users can only see their own evaluation runs.
alter table public.evaluation_runs enable row level security;

drop policy if exists "Users read own evaluation runs" on public.evaluation_runs;
create policy "Users read own evaluation runs"
  on public.evaluation_runs
  for select
  using (auth.uid() = user_id);

-- The evaluator microservice uses the service-role key, which bypasses RLS,
-- so it can insert/update rows on behalf of users.

-- 5. Auto-update updated_at on evaluation_runs.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists evaluation_runs_set_updated_at on public.evaluation_runs;
create trigger evaluation_runs_set_updated_at
  before update on public.evaluation_runs
  for each row execute function public.set_updated_at();
