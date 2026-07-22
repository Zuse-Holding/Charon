-- ============================================================
-- SELENE OS · Supabase schema · v1.0
-- Single source of truth for the agent and the dashboard.
-- Apply via: supabase db push  (or paste into SQL editor)
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- APPROVAL QUEUE — the heart of the system.
-- Every irreversible action Selene proposes lands here.
-- ------------------------------------------------------------
create table approval_queue (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  module        text not null check (module in ('inbox','finance','leads','brief','system')),
  action_type   text not null,             -- 'send_email' | 'add_ledger_entry' | 'contact_lead' | ...
  summary       text not null,             -- one line, Selene's voice, shown on the card
  payload       jsonb not null,            -- full draft / entry / action body
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','executed','failed')),
  resolved_at   timestamptz,               -- when Nick approved/rejected
  executed_at   timestamptz,               -- when the executor actually ran it
  error         text,
  related_lead  uuid,                      -- optional FK-ish links (soft, nullable)
  related_triage uuid
);
create index on approval_queue (status, created_at desc);

-- ------------------------------------------------------------
-- FINANCE
-- ------------------------------------------------------------
create table ledger (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  entry_date    date not null default current_date,
  vendor        text not null,
  description   text,
  amount        numeric(12,2) not null check (amount >= 0),
  direction     text not null check (direction in ('out','in')),
  category      text not null,             -- 'software' | 'domains' | 'hardware' | 'filing_fees' | 'api' | ...
  venture       text not null default 'zuse'
                check (venture in ('zuse','metis','charon','lounge','kairos','personal_mixed')),
  deductible    boolean not null default true,
  business_use_pct int not null default 100 check (business_use_pct between 0 and 100),
  receipt_url   text,
  source        text not null default 'manual'  -- 'manual' | 'email_forward' | 'agent'
);
create index on ledger (entry_date desc);
create index on ledger (venture, category);

create table recurring_costs (
  id            uuid primary key default gen_random_uuid(),
  vendor        text not null,
  description   text,
  amount        numeric(12,2) not null,
  cadence       text not null check (cadence in ('monthly','annual','usage')),
  next_renewal  date,
  venture       text not null default 'zuse',
  category      text not null default 'software',
  active        boolean not null default true
);

-- Seed the known burn (edit amounts to actuals):
insert into recurring_costs (vendor, description, amount, cadence, next_renewal, venture, category) values
  ('Namecheap/registrar', 'metisanalytic.com',            0.00, 'annual',  null, 'metis', 'domains'),
  ('Supabase',            'backend',                      0.00, 'monthly', null, 'zuse',  'software'),
  ('Vercel',              'hosting/deploys',              0.00, 'monthly', null, 'zuse',  'software'),
  ('Anthropic',           'Selene/Charon API usage',      0.00, 'usage',   null, 'zuse',  'api'),
  ('Groq',                'API usage',                    0.00, 'usage',   null, 'metis', 'api'),
  ('Serper',              'search API',                   0.00, 'usage',   null, 'metis', 'api');

-- ------------------------------------------------------------
-- LEADS
-- ------------------------------------------------------------
create table leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  source        text not null check (source in ('metis_form','inbox','manual','referral')),
  name          text,
  email         text,
  company       text,
  message       text,                      -- what they wrote / the email body summary
  status        text not null default 'new'
                check (status in ('new','enriched','contacted','replied','qualified','closed','dead')),
  score         int check (score between 0 and 100),
  enrichment    jsonb,                     -- Charon's write-up: {who, company, role, angle, flags}
  last_touch_at timestamptz
);
create index on leads (status, created_at desc);

create table lead_events (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  created_at    timestamptz not null default now(),
  event_type    text not null,             -- 'created' | 'enriched' | 'draft_queued' | 'contacted' | 'replied' | 'status_change'
  detail        text
);
create index on lead_events (lead_id, created_at);

-- ------------------------------------------------------------
-- COMPLIANCE CLOCK  (pure date math — no LLM dependency)
-- ------------------------------------------------------------
create table deadlines (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null check (kind in ('state','tax','domain','insurance','other')),
  due_date      date not null,
  recurrence    text check (recurrence in ('annual','biennial','none')),
  notes         text,
  status        text not null default 'open' check (status in ('open','done','waived')),
  completed_at  timestamptz
);
create index on deadlines (status, due_date);

-- Seed CA LLC obligations (VERIFY exact due dates against filing/formation dates):
insert into deadlines (title, kind, due_date, recurrence, notes) values
  ('CA Statement of Information — Zuse Holdings LLC', 'state', '2026-11-01', 'biennial',
   'Due within 90 days of formation, then biennially. Set to actual date from SOS filing.'),
  ('CA annual franchise tax — Zuse Holdings LLC', 'tax', '2027-04-15', 'annual',
   'Flat annual tax, applies regardless of revenue. Confirm first-year timing with CPA.'),
  ('metisanalytic.com renewal', 'domain', '2027-07-13', 'annual',
   'Registered ~Jul 2026; confirm exact renewal date at registrar.');

-- ------------------------------------------------------------
-- PERSONAL — Nick's own goals/countdowns, separate from Zuse Holdings
-- business ops. target_date is nullable: a dated row is a countdown
-- (rendered like the compliance clock), an undated one is just a standing
-- note/reminder.
-- ------------------------------------------------------------
create table personal_goals (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  title         text not null,
  target_date   date,
  notes         text,
  status        text not null default 'active' check (status in ('active','done')),
  completed_at  timestamptz
);
create index on personal_goals (status, target_date);

-- Seed with the two goals already pinned in the dashboard topbar:
insert into personal_goals (title, target_date, notes) values
  ('UCLA contract ends', '2027-06-29', 'End of the current UCLA contract term.'),
  ('Kyle''s $1M bet', '2027-07-15', 'Kyle''s bet: have a million by this date.');

-- ------------------------------------------------------------
-- INBOX TRIAGE
-- ------------------------------------------------------------
create table inbox_triage (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  gmail_message_id  text not null unique,   -- idempotency key
  received_at       timestamptz,
  from_addr         text,
  subject           text,
  bucket            text not null check (bucket in ('lead','vendor','legal_important','personal','noise')),
  summary           text,                   -- one line, Selene's voice
  needs_reply       boolean not null default false,
  draft_queued      uuid                    -- soft link -> approval_queue.id
);
create index on inbox_triage (bucket, created_at desc);

-- ------------------------------------------------------------
-- BRIEFS + MEMORY + RUN LOG
-- ------------------------------------------------------------
create table briefs (
  id            uuid primary key default gen_random_uuid(),
  week_of       date not null unique,
  content_md    text not null,
  stats         jsonb,                     -- {burn, burn_delta, leads_new, leads_moved, queue_open, deadlines_30d}
  created_at    timestamptz not null default now()
);

create table selene_facts (                -- migrated from selene_memory.db
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  fact          text not null,
  source        text default 'migration', -- 'migration' | 'conversation' | 'agent'
  active        boolean not null default true
);

create table agent_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  job           text not null,             -- 'inbox' | 'finance' | 'enrichment' | 'compliance' | 'brief'
  status        text not null default 'running'
                check (status in ('running','ok','failed')),
  cursor_after  text,                      -- e.g. last gmail message id processed
  actions_proposed int not null default 0,
  input_tokens  int,
  output_tokens int,
  est_cost_usd  numeric(10,4),
  log           text
);
create index on agent_runs (job, started_at desc);

-- ------------------------------------------------------------
-- RLS — single-user posture.
-- Agent uses SERVICE ROLE (bypasses RLS) server-side only.
-- Dashboard (anon/authenticated) can read everything and write
-- only what a human should: approvals, manual ledger, deadlines,
-- lead status. Public insert is allowed ONLY on leads (site form),
-- locked to source='metis_form'.
-- ------------------------------------------------------------
alter table approval_queue  enable row level security;
alter table ledger          enable row level security;
alter table recurring_costs enable row level security;
alter table leads           enable row level security;
alter table lead_events     enable row level security;
alter table deadlines       enable row level security;
alter table personal_goals  enable row level security;
alter table inbox_triage    enable row level security;
alter table briefs          enable row level security;
alter table selene_facts    enable row level security;
alter table agent_runs      enable row level security;

create policy "read all"        on approval_queue  for select using (true);
create policy "resolve queue"   on approval_queue  for update using (true)
  with check (status in ('approved','rejected'));
create policy "read ledger"     on ledger          for select using (true);
create policy "manual ledger"   on ledger          for insert with check (source = 'manual');
create policy "read recurring"  on recurring_costs for select using (true);
create policy "edit recurring"  on recurring_costs for all    using (true);
create policy "read leads"      on leads           for select using (true);
create policy "site form"       on leads           for insert with check (source = 'metis_form');
create policy "move leads"      on leads           for update using (true);
create policy "read lead ev"    on lead_events     for select using (true);
-- Dashboard logs its own status-change moves (LeadsView) the same way it's
-- allowed to make them ("move leads" above); scoped to that one event_type
-- so the dashboard can't backdate/forge enrichment or other agent-only events.
create policy "log lead move"   on lead_events     for insert with check (event_type = 'status_change');
create policy "read deadlines"  on deadlines       for select using (true);
create policy "edit deadlines"  on deadlines       for all    using (true);
create policy "read goals"      on personal_goals  for select using (true);
create policy "edit goals"      on personal_goals  for all    using (true);
create policy "read triage"     on inbox_triage    for select using (true);
create policy "read briefs"     on briefs          for select using (true);
create policy "read facts"      on selene_facts    for select using (true);
create policy "read runs"       on agent_runs      for select using (true);

-- NOTE: with single-user + Supabase Auth enabled, tighten `using (true)` to
-- `using (auth.uid() is not null)` once Nick's login exists. Until the dashboard
-- has auth, do not expose the anon key beyond the deployed app.
