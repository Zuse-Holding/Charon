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
                check (status in ('pending','approved','rejected','executing','executed','failed')),
  resolved_at   timestamptz,               -- when Nick approved/rejected
  executed_at   timestamptz,               -- when the executor actually ran it
  error         text,
  result        text,                      -- what the executor did (agents/executor.py)
  source_ref    text,                      -- idempotency key: gmail message id / lead id
  related_lead  uuid,                      -- optional FK-ish links (soft, nullable)
  related_triage uuid,
  constraint approval_queue_source_ref_key unique (action_type, source_ref)
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
                check (venture in ('zuse','metis','charon','lounge','kairos','personal_mixed','trading')),
  deductible    boolean not null default true,
  business_use_pct int not null default 100 check (business_use_pct between 0 and 100),
  receipt_url   text,
  source        text not null default 'manual', -- 'manual' | 'email_forward' | 'agent' | 'stripe'
  source_ref    text constraint ledger_source_ref_key unique  -- e.g. stripe:<invoice id>
);
create index on ledger (entry_date desc);
create index on ledger (venture, category);

-- ------------------------------------------------------------
-- TRADES — RETIRED with the Trading Bots venture (Committee replaces it;
-- Moneyball lives there now). Kept so past rows aren't lost.
-- Original note: buy/sell log for the trading-bots venture. Manual for now;
-- 'source' leaves room for a future Alpaca sync job to insert with
-- source='alpaca' (service role bypasses RLS) without opening that
-- source value to client-side inserts (same pattern as ledger.source).
-- ------------------------------------------------------------
create table trades (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  venture       text not null default 'trading',
  symbol        text not null,
  side          text not null check (side in ('buy','sell')),
  qty           numeric(18,8) not null check (qty > 0),
  price         numeric(18,4),                  -- fill price; null until filled
  filled_at     timestamptz,
  status        text not null default 'open' check (status in ('open','filled','canceled')),
  source        text not null default 'manual' check (source in ('manual','alpaca')),
  external_id   text,                            -- Alpaca order id, once wired
  bot           text,                            -- which bot placed it (Alpaca account name), null for manual rows
  notes         text
);
create index on trades (venture, filled_at desc);

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
  last_touch_at timestamptz,
  source_ref    text constraint leads_source_ref_key unique  -- gmail message id for inbox leads
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
-- INVOICES — sent through Stripe by agents/executor.py after approval;
-- status kept in step by agents/invoices.py.
-- ------------------------------------------------------------
create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  approval_id       uuid unique,                  -- approval_queue row that sent it
  stripe_invoice_id text not null unique,
  number            text,                         -- Stripe's human invoice number
  customer_email    text not null,
  customer_name     text,
  product           text check (product in ('intelligence','diligence','committee')),
  lead_id           uuid references leads(id) on delete set null,
  amount_due        numeric(12,2) not null check (amount_due >= 0),
  amount_paid       numeric(12,2) not null default 0,
  currency          text not null default 'usd',
  status            text not null default 'open'
                    check (status in ('open','paid','void','uncollectible')),
  due_date          date,
  hosted_url        text,                         -- the page the customer pays on
  paid_at           timestamptz,
  synced_at         timestamptz
);
create index if not exists invoices_status_idx on invoices (status, due_date);

-- ------------------------------------------------------------
-- COMPLIANCE CLOCK  (pure date math — no LLM dependency)
-- ------------------------------------------------------------
create table deadlines (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null check (kind in ('state','tax','domain','insurance','contract','other')),
  due_date      date not null,
  recurrence    text check (recurrence in ('annual','biennial','none')),
  notes         text,
  status        text not null default 'open' check (status in ('open','done','waived')),
  completed_at  timestamptz,
  source_ref    text constraint deadlines_source_ref_key unique  -- set by triggers (e.g. contract:<id>:ends)
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
-- CONTRACTS — NDAs, customer/vendor/partner agreements. Their dates reach
-- the compliance clock through the trigger below (pure SQL, no agent).
-- ------------------------------------------------------------
create table if not exists contracts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  title         text not null,               -- "Oak Tree NDA"
  counterparty  text not null,
  kind          text not null default 'other'
                check (kind in ('nda','customer','vendor','partner','contractor','other')),
  venture       text not null default 'zuse'
                check (venture in ('zuse','metis','charon','lounge','kairos','personal_mixed','trading')),
  product       text check (product in ('intelligence','diligence','committee')),  -- Metis products
  status        text not null default 'draft'
                check (status in ('draft','sent','signed','expired','terminated')),
  sent_on       date,
  signed_on     date,
  ends_on       date,                         -- term end / next renewal date
  auto_renews   boolean not null default false,
  renewal_months int check (renewal_months between 1 and 120),  -- term length when it auto-renews
  notice_days   int check (notice_days between 0 and 365),       -- notice needed before ends_on
  value_usd     numeric(12,2) check (value_usd >= 0),
  billing       text check (billing in ('one_time','monthly','annual')),
  doc_url       text,
  notes         text
);
create index if not exists contracts_status_idx on contracts (status, ends_on);

create or replace function sync_contract_deadlines() returns trigger
language plpgsql as $$
declare
  ends_ref   text;
  notice_ref text;
begin
  if tg_op = 'DELETE' then
    delete from deadlines where source_ref in ('contract:' || old.id || ':ends', 'contract:' || old.id || ':notice');
    return old;
  end if;

  ends_ref   := 'contract:' || new.id || ':ends';
  notice_ref := 'contract:' || new.id || ':notice';

  -- Term end / renewal date. A changed date reopens a row Nick had closed.
  if new.status = 'signed' and new.ends_on is not null then
    insert into deadlines (title, kind, due_date, recurrence, notes, source_ref)
    values (
      new.title || case when new.auto_renews then ' renews' else ' ends' end,
      'contract', new.ends_on, 'none', 'Contract with ' || new.counterparty || '.', ends_ref
    )
    on conflict (source_ref) do update set
      title        = excluded.title,
      notes        = excluded.notes,
      due_date     = excluded.due_date,
      status       = case when deadlines.due_date <> excluded.due_date then 'open' else deadlines.status end,
      completed_at = case when deadlines.due_date <> excluded.due_date then null else deadlines.completed_at end;
  else
    update deadlines set status = 'waived' where source_ref = ends_ref and status = 'open';
  end if;

  -- Last day to give notice (or to cancel before an auto-renewal).
  if new.status = 'signed' and new.ends_on is not null and coalesce(new.notice_days, 0) > 0 then
    insert into deadlines (title, kind, due_date, recurrence, notes, source_ref)
    values (
      'Notice deadline: ' || new.title, 'contract', new.ends_on - new.notice_days, 'none',
      case when new.auto_renews
        then 'Last day to cancel before it auto-renews.'
        else 'Last day to give notice before it ends.' end,
      notice_ref
    )
    on conflict (source_ref) do update set
      title        = excluded.title,
      notes        = excluded.notes,
      due_date     = excluded.due_date,
      status       = case when deadlines.due_date <> excluded.due_date then 'open' else deadlines.status end,
      completed_at = case when deadlines.due_date <> excluded.due_date then null else deadlines.completed_at end;
  else
    update deadlines set status = 'waived' where source_ref = notice_ref and status = 'open';
  end if;

  return new;
end $$;

drop trigger if exists contracts_deadlines on contracts;
create trigger contracts_deadlines
  after insert or update or delete on contracts
  for each row execute function sync_contract_deadlines();


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
alter table trades          enable row level security;
alter table contracts       enable row level security;
alter table invoices        enable row level security;

create policy "read all"        on approval_queue  for select using (true);
-- No anon update on approval_queue: approve/reject/undo go through the
-- dashboard's /api/ops/queue route (service role, behind its login), since
-- an approved row now really gets executed (agents/executor.py).
create policy "read ledger"     on ledger          for select using (true);
create policy "manual ledger"   on ledger          for insert with check (source = 'manual');
create policy "read trades"     on trades          for select using (true);
create policy "manual trades"   on trades          for insert with check (source = 'manual');
create policy "edit trades"     on trades          for update using (true);
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
create policy "read invoices"   on invoices        for select using (true);
create policy "read contracts"  on contracts       for select using (true);
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
