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
-- Indexes for query performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_runs_user_date
  ON research_runs (user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_watchlist_user
  ON watchlist (user_id);

CREATE INDEX IF NOT EXISTS idx_deep_dives_user_company
  ON deep_dives (user_id, company);
