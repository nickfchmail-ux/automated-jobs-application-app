-- ============================================================
--  Subscription & usage entitlements
--
--  Two new tables power the plan-based usage limits:
--    profiles       — one row per user: role (user/admin), Stripe
--                     customer id, plan, subscription status.
--    usage_records  — one row per entitlement-consuming event
--                     (search / evaluation / fine-tune), so free
--                     limits are derivable AND auditable.
--
--  RLS: users can read/write only their OWN profile + usage rows.
--  The service-role key (used by server actions) bypasses RLS.
-- ============================================================

-- ── profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                TEXT,
  role                 TEXT NOT NULL DEFAULT 'user'
                       CHECK (role IN ('user', 'admin')),
  plan                 TEXT NOT NULL DEFAULT 'free'
                       CHECK (plan IN ('free', 'pro')),
  subscription_status  TEXT NOT NULL DEFAULT 'none'
                       CHECK (subscription_status IN (
                         'none','trialing','active','past_due',
                         'canceled','unpaid','incomplete',
                         'incomplete_expired','paused'
                       )),
  stripe_customer_id   TEXT,
  current_period_end   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── usage_records ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_records (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_type   TEXT NOT NULL CHECK (usage_type IN (
                 'search','evaluation',
                 'fine_tune_resume','fine_tune_cover_letter'
               )),
  search_key   TEXT,                 -- normalized key for per-key limits
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── stripe_events (webhook idempotency) ─────────────────────
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id    TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: nobody reads these from the client; service-role only.
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No client access to stripe_events" ON public.stripe_events;
CREATE POLICY "No client access to stripe_events"
  ON public.stripe_events FOR ALL USING (false);

-- Unique: one record per (user, type, key) — makes the free-tier
-- "count then insert" check race-safe (a concurrent double-click can't
-- double-spend the last quota; the 2nd insert hits this unique violation).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_dedup
  ON public.usage_records (user_id, usage_type, search_key);

CREATE INDEX IF NOT EXISTS idx_usage_user_type
  ON public.usage_records (user_id, usage_type);

-- ── updated_at trigger (parity with jobs) ──────────────────
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;

-- profiles: select/insert/update own
DROP POLICY IF EXISTS "Users select own profile" ON public.profiles;
CREATE POLICY "Users select own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- usage_records: select/insert own (service-role writes bypass RLS)
DROP POLICY IF EXISTS "Users select own usage" ON public.usage_records;
CREATE POLICY "Users select own usage"
  ON public.usage_records FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own usage" ON public.usage_records;
CREATE POLICY "Users insert own usage"
  ON public.usage_records FOR INSERT WITH CHECK (auth.uid() = user_id);
