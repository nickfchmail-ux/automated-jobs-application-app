-- =====================================================================
-- Recover stale document-generation state (user-facing coherence fix)
--
-- Context: the OLD pipeline set `jobs.resume_status = 'building'` but its
-- resume worker was a disabled no-op, so ~249 fit jobs were left stuck at
-- `building` forever (last updated 2026-08-19). On the redesigned job
-- detail page, a stuck `building` would show an endless "Generating…"
-- spinner — bad UX.
--
-- Also: existing fit jobs that already have a generated `cover_letter`
-- (written by the old evaluator directly on the row) have
-- `cover_letter_status = 'none'`, so the new cover-letter card would show a
-- "Generate" button even though the letter already exists.
--
-- Fix:
--   1. Backfill `cover_letter_status = 'completed'` for fit jobs that
--      already carry a non-null cover_letter.
--   2. Recover STALE `resume_status = 'building'` / `cover_letter_status =
--      'building'` (started > 2 hours ago and not touched since) to
--      `failed` with a clear error, so the UI shows a Retry path instead of
--      an eternal spinner. Anything recently started by the new workers is
--      left alone.
-- =====================================================================

-- ── 1. Backfill cover-letter status from existing generated letters ──
update public.jobs
set cover_letter_status = 'completed',
    cover_letter_completed_at = coalesce(cover_letter_completed_at, updated_at)
where fit = true
  and cover_letter is not null
  and cover_letter <> ''
  and cover_letter_status = 'none';

-- ── 2. Recover stale "building" resumes (stuck from the old pipeline) ──
update public.jobs
set resume_status = 'failed',
    resume_error = 'The previous resume build was interrupted. Tap "Generate" to retry.',
    updated_at = now()
where resume_status = 'building'
  and (
    resume_started_at is null
    or resume_started_at < now() - interval '2 hours'
  )
  and updated_at < now() - interval '2 hours';

-- ── 3. Recover stale "building" cover letters (same logic) ──
update public.jobs
set cover_letter_status = 'failed',
    cover_letter_error = 'The previous cover-letter build was interrupted. Tap "Generate" to retry.',
    updated_at = now()
where cover_letter_status = 'building'
  and (
    cover_letter_started_at is null
    or cover_letter_started_at < now() - interval '2 hours'
  )
  and updated_at < now() - interval '2 hours';
