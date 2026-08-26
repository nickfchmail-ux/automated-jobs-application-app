-- =====================================================================
-- AI Evaluator — per-version document state for fine-tuning
--
-- The fine-tune feature produces MULTIPLE versions of each document
-- (resume + cover letter): the original v1 and one version per refinement
-- pass (v2, v3, …). Before this migration the frontend inferred versions by
-- listing storage files (unreliable for private buckets, no per-version
-- state). This table is the AUTHORITATIVE source for the version nav:
--
--   - one row per (user_id, job_id, type, version)
--   - per-version status (building / completed / failed) → Realtime lets
--     the overlay show "Regenerating…" on the building tab and switch to the
--     new version the moment it completes
--   - the refinement note that produced each version (so the user can see
--     what changed)
--   - the versioned file URL + file name in the private storage bucket
--
-- Status mirrors jobs.resume_status / jobs.cover_letter_status (the LATEST
-- artifact is still mirrored there for the card badges); this table tracks
-- EVERY version.
--
-- RLS: users can read/write their own rows. The evaluator uses the
-- service-role key (bypasses RLS) to write on the user's behalf.
-- =====================================================================

create table if not exists public.document_versions (
  id            uuid        primary key default gen_random_uuid(),

  -- ── Links ────────────────────────────────────────────────────
  user_id       uuid        not null references auth.users (id) on delete cascade,
  job_id        uuid        not null references public.jobs (id)   on delete cascade,
  doc_type      text        not null check (doc_type in ('resume', 'cover-letter')),

  -- ── Version identity ─────────────────────────────────────────
  version       integer     not null default 1,

  -- ── State machine (streams to the overlay via Realtime) ─────
  status        text        not null default 'building'
                check (status in ('building', 'completed', 'failed')),

  -- ── Output location (private bucket; served via API route) ──
  url           text,       -- public URL (used when the bucket is public)
  file_name     text,       -- "<userId>-<jobId>-v<N>.html|txt" in storage
  error         text,       -- error message when failed

  -- ── Provenance ───────────────────────────────────────────────
  -- The user's refinement note that produced THIS version (null = original).
  refinement    text,
  -- What this version was built from (version number of the previous one).
  based_on      integer,

  -- ── Timestamps ───────────────────────────────────────────────
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,

  constraint uq_document_version unique (user_id, job_id, doc_type, version)
);

comment on table public.document_versions is
  'Per-version state for fine-tuned documents (resume + cover letter). '
  'The overlay reads this to render the version nav with live status.';

-- ── Indexes for the hot query paths ─────────────────────────────
create index if not exists idx_document_versions_user
  on public.document_versions (user_id);
create index if not exists idx_document_versions_job_type_version
  on public.document_versions (job_id, doc_type, version);
create index if not exists idx_document_versions_status
  on public.document_versions (status);

-- ── Row Level Security ──────────────────────────────────────────
-- Users can only see / manage their own document versions. The evaluator
-- uses the service-role key (bypasses RLS) to write rows on the user's
-- behalf, mirroring the pattern on `generated_resumes`.
alter table public.document_versions enable row level security;

drop policy if exists "Users read own document versions" on public.document_versions;
create policy "Users read own document versions"
  on public.document_versions
  for select
  using (auth.uid() = user_id);

-- ── Realtime: stream per-version state to the overlay ───────────
alter publication supabase_realtime add table public.document_versions;
