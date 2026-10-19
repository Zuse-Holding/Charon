-- ============================================================
-- Rebuild prelude: the three tables that were created by hand in the
-- Supabase dashboard and never written into schema.sql. Run this FIRST,
-- before schema.sql: schema.sql only ALTERs `profiles` (display_name,
-- Stripe columns, grace/email timestamps) and its signup trigger inserts
-- into it, so the base table has to exist already.
--
-- Columns are reconstructed from how the code uses each table:
--   profiles             server/agent-server.ts getUserTier, the Stripe
--                        routes (web/app/api/stripe/*), run-day7-email-job
--   person_search_audit  server/agent-server.ts (monthly person-search cap)
--   pinned_feed_items    web/app/api/intel-feed/pin/route.ts
-- ============================================================

-- One row per auth user (created by schema.sql's on_auth_user_created
-- trigger). tier stays NULL until a plan is set; getUserTier reads NULL as
-- "free", which is how new accounts behaved before. Written only with the
-- service role (agent server, Stripe webhook), never by the user's own
-- client, so there is deliberately no user UPDATE policy: a user must not
-- be able to set their own tier.
CREATE TABLE IF NOT EXISTS public.profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier              TEXT,
  trial_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- Audit log behind the 25/month person-search cap. Service role only.
CREATE TABLE IF NOT EXISTS public.person_search_audit (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  query_target  TEXT        NOT NULL,
  search_type   TEXT        NOT NULL,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS person_search_audit_user_month
  ON public.person_search_audit (user_id, created_at);

ALTER TABLE public.person_search_audit ENABLE ROW LEVEL SECURITY;

-- Intel feed pins. Read and written with the signed-in user's own client,
-- so it needs per-user policies. upsert uses onConflict "user_id,item_key".
CREATE TABLE IF NOT EXISTS public.pinned_feed_items (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key   TEXT        NOT NULL,
  headline   TEXT,
  sector     TEXT,
  url        TEXT,
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, item_key)
);

ALTER TABLE public.pinned_feed_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own pins" ON public.pinned_feed_items;
CREATE POLICY "Users manage own pins" ON public.pinned_feed_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
