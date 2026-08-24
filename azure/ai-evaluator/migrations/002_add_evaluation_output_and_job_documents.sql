-- Story A + B: AI evaluation extended output + per-job document generation
-- Additive migration for the AI evaluator microservice.

-- Story A: evaluation now returns a justification + reasons it is NOT a fit.
alter table public.jobs
  add column if not exists justification text,
  add column if not exists not_fit_reasons jsonb default '[]'::jsonb;

-- Story B: per-job tailored resume + cover letter artifacts.
-- (resume_status / resume_url / resume_pdf_url already exist; add error column
--  if missing for clean failure surfacing to the frontend badge.)
alter table public.jobs
  add column if not exists resume_error text;

-- Storage bucket for generated per-job documents:
--   job-documents/{userId}/{jobId}/resume.html
-- Bucket is created here so the function deploy does not fail on a missing bucket.
insert into storage.buckets (id, name, public)
values ('job-documents', 'job-documents', false)
on conflict (id) do nothing;

-- Storage RLS: owners can read their own generated documents.
drop policy if exists "job-documents read own" on storage.objects;
create policy "job-documents read own"
  on storage.objects for select
  using (
    bucket_id = 'job-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Service-role writes (evaluator) bypass RLS; no insert policy needed for anon.
