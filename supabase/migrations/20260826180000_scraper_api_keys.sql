-- ============================================================
--  ScraperAPI key rotation ledger
--
--  Stores ALL ScraperAPI keys (the paid proxy used ONLY for the
--  Indeed board). The backend rotates through keys when one hits
--  its monthly credit cap, and marks each key exhausted_on the
--  day it runs out. If EVERY key is exhausted today, the frontend
--  hides/disabled the Indeed button until a key resets tomorrow.
--
--  The Azure function is the single writer (service-role key); the
--  frontend only READS availability via a server action.
-- ============================================================

create table if not exists public.scraper_api_keys (
  id            uuid        primary key default gen_random_uuid(),
  key_value     text        not null unique,
  label         text        not null default 'ScraperAPI key',

  -- Rotation state
  is_active     boolean     not null default false,
  exhausted_on  date,                -- the day it was found exhausted (null = healthy)

  -- Telemetry
  last_used_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.scraper_api_keys is
  'ScraperAPI keys used ONLY for Indeed scraping. One is active; keys '
  'rotate on credit exhaustion and are marked exhausted_on the day they '
  'run out. If all are exhausted today, Indeed is hidden in the UI.';

create index if not exists idx_scraper_api_keys_active
  on public.scraper_api_keys (is_active) where is_active = true;
create index if not exists idx_scraper_api_keys_exhausted
  on public.scraper_api_keys (exhausted_on);

-- ── RLS: no public writes. The Azure function uses the service-role
--    key (bypasses RLS). The frontend reads via a server action only,
--    so the table itself can stay closed to anon/authenticated roles.
alter table public.scraper_api_keys enable row level security;
drop policy if exists "scraper_api_keys no anon access" on public.scraper_api_keys;
create policy "scraper_api_keys no anon access"
  on public.scraper_api_keys
  for select
  using (false); -- RLS denies everyone; only service-role (bypass) can read
