-- ═══════════════════════════════════════════════════════════════════
-- KEEPSTEAD — ADMIN DASHBOARD + COMPLETION REQUESTS SCHEMA
-- Run against project fufhjraudksavfncpdrm in Supabase SQL editor.
-- Safe to re-run (uses IF NOT EXISTS + DROP POLICY IF EXISTS).
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. PROFILES TABLE
-- Needed so admin.html can list users from client JS (anon key cannot
-- query auth.users directly). Kept in sync with auth.users via trigger.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  full_name     text,
  tier          text NOT NULL DEFAULT 'free'
                CHECK (tier IN ('free','paid_single','paid_bundle','paid_unlimited')),
  signup_date   timestamptz NOT NULL DEFAULT now(),
  last_login    timestamptz,
  last_organizer text  -- trade code (dc, pm, etc.) — used to auto-surface Resume shortcut on home
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_organizer text;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- Trigger: insert a profile row every time auth.users gets a new row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, signup_date)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.created_at
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for any existing users.
INSERT INTO public.profiles (id, email, full_name, signup_date)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', ''),
  u.created_at
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

-- RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_profile"       ON public.profiles;
DROP POLICY IF EXISTS "users_update_own_profile"    ON public.profiles;
DROP POLICY IF EXISTS "admin_full_access_profiles"  ON public.profiles;

CREATE POLICY "users_see_own_profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "admin_full_access_profiles" ON public.profiles
  FOR ALL USING (auth.jwt() ->> 'email' = 'kari@karikounkel.com');

-- Helper RPC so admin.html can stamp last_login (updates own row; admin gets all via policy).
CREATE OR REPLACE FUNCTION public.touch_last_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET last_login = now() WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_login() TO authenticated;


-- ───────────────────────────────────────────────────────────────────
-- 2. COMPLETION REQUESTS TABLE
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.completion_requests (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email        text NOT NULL,
  trade_code        text NOT NULL,
  report_type       text NOT NULL
                    CHECK (report_type IN ('prep_worksheet','tax_reference','bundle_single','bundle_unlimited')),
  tier_paid         numeric NOT NULL,
  stripe_session_id text,
  notes             text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','done','cancelled')),
  pdf_url           text,
  requested_at      timestamptz DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_completion_requests_user
  ON public.completion_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_completion_requests_status
  ON public.completion_requests(status);

-- Unique stripe_session_id so the webhook can upsert idempotently
-- (Stripe retries deliver same event id; we want single row per checkout).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_completion_requests_stripe_session
  ON public.completion_requests(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- Years ordered (per-year one-time pricing: filer picks which tax years they
-- want docs for; quantity = years_ordered.length; total charged = tier_paid * length).
ALTER TABLE public.completion_requests
  ADD COLUMN IF NOT EXISTS years_ordered text[];

ALTER TABLE public.completion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_requests"   ON public.completion_requests;
DROP POLICY IF EXISTS "admin_sees_all_requests"  ON public.completion_requests;

CREATE POLICY "users_see_own_requests" ON public.completion_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "admin_sees_all_requests" ON public.completion_requests
  FOR ALL USING (auth.jwt() ->> 'email' = 'kari@karikounkel.com');


-- ───────────────────────────────────────────────────────────────────
-- 3. TRADE-USAGE VIEW (for Admin Dashboard → Trade Usage card)
-- Counts one submission table per known trade; unions them.
-- Add more trades here as their submission tables come online.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.trade_usage_counts AS
SELECT 'dc' AS trade_code, count(*)::int AS active_users FROM public.dc_organizer_submissions
UNION ALL SELECT 'pm', count(*)::int FROM public.pm_organizer_submissions
UNION ALL SELECT 'ev', count(*)::int FROM public.ev_organizer_submissions
UNION ALL SELECT 'gn', count(*)::int FROM public.gn_organizer_submissions
UNION ALL SELECT 'yd', count(*)::int FROM public.yd_organizer_submissions
UNION ALL SELECT 'cr', count(*)::int FROM public.cr_organizer_submissions
UNION ALL SELECT 'au', count(*)::int FROM public.au_organizer_submissions
UNION ALL SELECT 'cl', count(*)::int FROM public.cl_organizer_submissions;

-- NOTE: if a submission table does not exist yet, comment out its line above
-- before running. Add dw/fn/rs/tp/tr/w2 lines when those tables are created.


-- ───────────────────────────────────────────────────────────────────
-- 4. (OPTIONAL) W-2 / 1099 WAGE-EARNER ORGANIZER TABLE
-- Only create if w2.html is deployed.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.w2_organizer_submissions (
  user_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  filer_name      text,
  submitted_at    timestamptz,
  raw_form_data   jsonb,
  years_covered   text[],
  status          text DEFAULT 'in_progress'
);

ALTER TABLE public.w2_organizer_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "w2_user_own"   ON public.w2_organizer_submissions;
DROP POLICY IF EXISTS "w2_admin_all"  ON public.w2_organizer_submissions;

CREATE POLICY "w2_user_own" ON public.w2_organizer_submissions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "w2_admin_all" ON public.w2_organizer_submissions
  FOR ALL USING (auth.jwt() ->> 'email' = 'kari@karikounkel.com');


-- ───────────────────────────────────────────────────────────────────
-- 4b. SHARED SIDE-INCOME (W-2 + 1099 + IRS TRANSCRIPTS)
-- Universal across every organizer — the person's wage & 1099 picture
-- belongs to the filer, not the trade. Keyed by user_id only; years
-- and per-form data live in the jsonb blob.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.side_income_submissions (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.side_income_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "side_income_user_own"  ON public.side_income_submissions;
DROP POLICY IF EXISTS "side_income_admin_all" ON public.side_income_submissions;

CREATE POLICY "side_income_user_own" ON public.side_income_submissions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "side_income_admin_all" ON public.side_income_submissions
  FOR ALL USING (auth.jwt() ->> 'email' = 'kari@karikounkel.com');

-- Storage bucket for IRS transcripts + uploaded 1099/W-2 images
-- Path convention: {user_id}/{year}/{kind}/{filename}
--   kind ∈ ('transcript','1099','w2','other')
INSERT INTO storage.buckets (id, name, public)
VALUES ('irs-docs', 'irs-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "irs_docs_owner_read"   ON storage.objects;
DROP POLICY IF EXISTS "irs_docs_owner_write"  ON storage.objects;
DROP POLICY IF EXISTS "irs_docs_admin_all"    ON storage.objects;

CREATE POLICY "irs_docs_owner_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'irs-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "irs_docs_owner_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'irs-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "irs_docs_admin_all" ON storage.objects
  FOR ALL USING (
    bucket_id = 'irs-docs'
    AND auth.jwt() ->> 'email' = 'kari@karikounkel.com'
  );


-- ───────────────────────────────────────────────────────────────────
-- 5. STORAGE BUCKET FOR COMPLETED PDFs
-- Admin uploads finished report here, sets pdf_url on the request row.
-- ───────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('completion-reports', 'completion-reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "owner_can_read_own_report"   ON storage.objects;
DROP POLICY IF EXISTS "admin_can_manage_reports"    ON storage.objects;

-- File path convention:  {user_id}/{completion_request_id}.pdf
CREATE POLICY "owner_can_read_own_report" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'completion-reports'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "admin_can_manage_reports" ON storage.objects
  FOR ALL USING (
    bucket_id = 'completion-reports'
    AND auth.jwt() ->> 'email' = 'kari@karikounkel.com'
  );
