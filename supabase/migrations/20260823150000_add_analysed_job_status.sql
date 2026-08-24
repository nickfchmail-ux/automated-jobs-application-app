-- Story C: allow the evaluator to persist `analysed` on evaluated jobs.
--
-- The AI evaluator writes status = 'analysed' once a job has been scored
-- (see evaluateBatch.ts and the frontend lifecycle mapping in
-- RealtimeJobStream.tsx which maps analysing/analysed -> "scored"). The
-- original jobs_status_check constraint only allowed 'analysing' (the
-- in-progress state), so every evaluation batch failed with:
--
--   new row for relation "jobs" violates check constraint "jobs_status_check"
--
-- Fix: rebuild the constraint to include 'analysed' alongside all the
-- scraping-pipeline states.
alter table public.jobs
  drop constraint if exists jobs_status_check;

alter table public.jobs
  add constraint jobs_status_check check (
    status = any (array[
      'discovered'::text,
      'queued'::text,
      'scraping'::text,
      'processing'::text,
      'enriching'::text,
      'analysing'::text,
      'analysed'::text,
      'completed'::text,
      'failed'::text,
      'duplicate'::text,
      'retrying'::text
    ])
  );
