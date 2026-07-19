-- ============================================================
-- SELINE INTEL — Supabase Database Schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Research runs (Tier 1 quick profiles)
CREATE TABLE IF NOT EXISTS research_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL CHECK (type IN ('company', 'person', 'product', 'political')),
  subject      TEXT        NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  report_path  TEXT,
  bundle       JSONB,
  status       TEXT        NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlist
CREATE TABLE IF NOT EXISTS watchlist (
  id                   TEXT        PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                 TEXT        NOT NULL CHECK (type IN ('company', 'person', 'product', 'political')),
  subject              TEXT        NOT NULL,
  added_at             TIMESTAMPTZ NOT NULL,
  last_refreshed_at    TIMESTAMPTZ,
  refresh_interval_days INTEGER    DEFAULT 3,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Deep dives (Tier 2 analyst reports)
CREATE TABLE IF NOT EXISTS deep_dives (
  id           TEXT        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company      TEXT        NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  duration_ms  INTEGER,
  sections     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security — users only see their own data
-- Even if there's a bug in the app, data cannot leak between users
-- ============================================================

ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_dives    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own research runs"
  ON research_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own watchlist"
  ON watchlist FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own deep dives"
  ON deep_dives FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Knowledge Graph (Phase 1) — entity extraction storage
-- Populated automatically after each research run completes.
-- No UI yet — this just accumulates relationship data so the
-- graph visualization (Phase 2+) has real data to work with.
-- ============================================================

CREATE TABLE IF NOT EXISTS kg_entities (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  type         TEXT        NOT NULL CHECK (type IN ('company', 'person', 'product')),
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  source_run_id UUID        REFERENCES research_runs(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name, type)
);

CREATE TABLE IF NOT EXISTS kg_relationships (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_entity_id    UUID        NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  to_entity_id      UUID        NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  relationship_type TEXT        NOT NULL, -- e.g. FOUNDED, COMPETES_WITH, ACQUIRED, PARTNERED_WITH, WORKS_AT
  source_run_id     UUID        REFERENCES research_runs(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kg_entities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own entities"
  ON kg_entities FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own relationships"
  ON kg_relationships FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_kg_entities_user_name
  ON kg_entities (user_id, name);

CREATE INDEX IF NOT EXISTS idx_kg_relationships_user_from
  ON kg_relationships (user_id, from_entity_id);

CREATE INDEX IF NOT EXISTS idx_kg_relationships_user_to
  ON kg_relationships (user_id, to_entity_id);

-- ============================================================
-- Indexes for core tables (research_runs, watchlist, deep_dives)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_runs_user_date
  ON research_runs (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_user
  ON watchlist (user_id);

CREATE INDEX IF NOT EXISTS idx_deep_dives_user_company
  ON deep_dives (user_id, company);

-- ============================================================
-- Display name (Round 2, item 8)
-- `profiles` already exists (tier, trial_expires_at live there —
-- see server/agent-server.ts getUserTier) but its CREATE TABLE isn't
-- captured in this file, so this is an ALTER rather than a fresh table.
-- Nullable: the app falls back to an email-derived name when empty
-- (see web/lib/tier-context.tsx deriveDisplayName).
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Reads/writes for this column go through the agent server's service-role
-- key (server/agent-server.ts /tier and /profile routes), not a direct
-- browser Supabase call, so no client-facing RLS policy is required for
-- display_name specifically. If profiles RLS is ever tightened to block
-- the service role too, add:
--   CREATE POLICY "Users manage own profile" ON profiles FOR UPDATE
--     USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- Political research type (Round 2, item 1)
-- research_runs.type and watchlist.type were created with a CHECK
-- constraint of ('company','person','product') before political
-- research existed, which silently 500'd every political run at the
-- DB insert step (app-level validation passed, Postgres rejected the
-- row). The CREATE TABLE statements above are already updated for
-- fresh databases; run this block against an existing database to
-- widen the constraint on tables that already exist.
-- ============================================================

ALTER TABLE research_runs DROP CONSTRAINT IF EXISTS research_runs_type_check;
ALTER TABLE research_runs ADD CONSTRAINT research_runs_type_check
  CHECK (type IN ('company', 'person', 'product', 'political'));

ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_type_check;
ALTER TABLE watchlist ADD CONSTRAINT watchlist_type_check
  CHECK (type IN ('company', 'person', 'product', 'political'));

-- ============================================================
-- Auto-create profiles row on signup
-- `profiles` rows were only ever created lazily, the first time a user
-- saved a display name (PATCH /profile in server/agent-server.ts). Any
-- account that never opened Settings has no profiles row at all, which
-- broke anything with a foreign key into profiles(id) — specifically
-- person_search_audit, seen failing in production logs with:
--   insert or update on table "person_search_audit" violates foreign
--   key constraint "person_search_audit_user_id_fkey"
-- getUserTier() already tolerates a missing row (falls back to "basic"),
-- so this never showed up as a tier bug — only as a silent audit-log
-- failure, which also meant the 25/month person-search cap was never
-- actually being enforced for these accounts, since their searches never
-- got logged in the first place.
-- ============================================================

-- Auto-create a profiles row whenever a new auth user is created — covers
-- every signup path (email/password, Google OAuth, etc.) uniformly,
-- rather than depending on a specific app code path running. Matches
-- Supabase's own documented pattern for this exact problem.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Backfill every existing account that signed up before this trigger
-- existed — fixes the account already failing in production
-- (675633e2-2521-4f0a-833c-75eeb208e8cc) and any other pre-existing
-- account in the same state.
INSERT INTO public.profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Background-persistent search
-- research_runs previously only ever got a row AFTER the run finished
-- (agent-server inserted the completed bundle in one shot), so there was
-- no record of a run "in progress" — a page reload or closed tab during
-- a run left zero trace it was ever happening, even though the actual
-- research kept running server-side regardless (Node doesn't abort a
-- handler just because the client disconnected). This adds a status so
-- agent-server can insert a 'pending' row the moment a run starts and
-- flip it to 'completed'/'failed' when it's done — the web app can then
-- poll for a pending row on load and resume showing progress instead of
-- losing it. Column add backfills existing (all-completed) rows to
-- 'completed' automatically via the DEFAULT.
-- ============================================================

ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE research_runs DROP CONSTRAINT IF EXISTS research_runs_status_check;
ALTER TABLE research_runs ADD CONSTRAINT research_runs_status_check
  CHECK (status IN ('pending', 'completed', 'failed'));
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS error TEXT;
