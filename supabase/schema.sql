-- ============================================================
-- SELINE INTEL — Supabase Database Schema
-- Run this in Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- Research runs (Tier 1 quick profiles)
CREATE TABLE IF NOT EXISTS research_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL CHECK (type IN ('company', 'person', 'product')),
  subject      TEXT        NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  report_path  TEXT,
  bundle       JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Watchlist
CREATE TABLE IF NOT EXISTS watchlist (
  id                   TEXT        PRIMARY KEY,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type                 TEXT        NOT NULL CHECK (type IN ('company', 'person', 'product')),
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
