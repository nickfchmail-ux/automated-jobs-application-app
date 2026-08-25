-- =====================================================================
-- AI Evaluator — independent cover-letter generation state
--
-- The cover letter is now generated ON DEMAND by its own Azure Function +
-- Service Bus queue (`cover-letter-requests`), fully decoupled from the AI
-- evaluation run. These columns let the job detail page show the live
-- generation state over Supabase Realtime (none → building → completed /
-- failed), so a page refresh mid-generation never loses the state.
--
-- Status values (mirrors jobs.resume_status):
--   none            (default — no cover letter requested / not generated)
--   building        (coverLetterWorker is generating)
--   completed       (cover_letter text is set)
--   failed          (generation failed; cover_letter_error set)
-- =====================================================================

alter table public.jobs
  add column if not exists cover_letter_status text
    default 'none'
    check (cover_letter_status in ('none', 'building', 'completed', 'failed'));

alter table public.jobs
  add column if not exists cover_letter_error text;

alter table public.jobs
  add column if not exists cover_letter_started_at timestamptz;

alter table public.jobs
  add column if not exists cover_letter_completed_at timestamptz;

create index if not exists idx_jobs_cover_letter_status
  on public.jobs (cover_letter_status);
