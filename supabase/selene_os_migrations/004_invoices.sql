-- ============================================================
-- SELENE OS · migration 004 · Stripe invoices
-- Run once in the Supabase SQL editor after 003. supabase/selene_os_schema.sql matches.
--
-- An invoice starts as an approval_queue row (action_type 'send_invoice').
-- agents/executor.py creates and sends it in Stripe after Nick approves,
-- then records it here. agents/invoices.py (cron, pure code) keeps status
-- in step with Stripe and logs each payment to the ledger exactly once.
-- ============================================================

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

-- Payments land in the ledger once per Stripe invoice, keyed here.
alter table ledger add column if not exists source_ref text;
alter table ledger drop constraint if exists ledger_source_ref_key;
alter table ledger add constraint ledger_source_ref_key unique (source_ref);

alter table invoices enable row level security;
drop policy if exists "read invoices" on invoices;
create policy "read invoices" on invoices for select using (true);
