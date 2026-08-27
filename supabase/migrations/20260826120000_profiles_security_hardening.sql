-- ============================================================
--  SECURITY HARDENING: lock down privileged profile columns
--
--  End users must NEVER be able to set role='admin', plan='pro',
--  subscription_status, or stripe_customer_id on their own row —
--  otherwise anyone could self-promote to admin and bypass every
--  entitlement check. These columns are written ONLY by the
--  service-role key (server actions + Stripe webhook), which
--  bypasses RLS.
--
--  We REVOKE the privileged columns from the `authenticated` role
--  at the column level. This is enforced regardless of any row-level
--  UPDATE policy: a user's UPDATE simply cannot touch those columns.
-- ============================================================

-- ── UPDATE: block privileged columns for end users ───────────
REVOKE UPDATE (role, plan, subscription_status, stripe_customer_id)
  ON public.profiles FROM authenticated;

-- ── INSERT: block pre-seeding privileged columns on create ────
REVOKE INSERT (role, plan, subscription_status, stripe_customer_id)
  ON public.profiles FROM authenticated;
