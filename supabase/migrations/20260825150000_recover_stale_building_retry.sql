-- =====================================================================
-- Recover stale "building" resumes (corrected condition)
--
-- The previous recovery migration (20260825140000) keyed off `updated_at`,
-- but `updated_at` on these rows had been bumped to "now" by earlier ALTERs
-- (adding columns), so the 2-hour window missed them. The authoritative
-- "how long has this been building" signal is `resume_started_at`, which is
-- still the stale 2026-08-18 timestamp for the old stuck pipeline.
--
-- Recover STALE `building` → `failed` using `resume_started_at` (or a null
-- start treated as ancient). Jobs started recently by the NEW workers
-- (resume_started_at within the last 2 hours) are left alone.
-- =====================================================================

update public.jobs
set resume_status = 'failed',
    resume_error = 'The previous resume build was interrupted. Tap "Generate" to retry.',
    updated_at = now()
where resume_status = 'building'
  and (
    resume_started_at is null
    or resume_started_at < now() - interval '2 hours'
  );
