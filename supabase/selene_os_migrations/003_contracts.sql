-- ============================================================
-- SELENE OS · migration 003 · contracts + their dates on the clock
-- Run once in the Supabase SQL editor after 002. supabase/selene_os_schema.sql matches.
--
-- Contract dates reach the compliance clock through a trigger, not the
-- agent: pure SQL, fires on every insert/update, so the clock is right the
-- moment a contract is saved and never depends on a model (CLAUDE.md #3).
-- ============================================================

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

-- Deadlines learn where they came from, so the trigger can upsert its own
-- rows without touching hand-entered ones.
alter table deadlines add column if not exists source_ref text;
alter table deadlines drop constraint if exists deadlines_source_ref_key;
alter table deadlines add constraint deadlines_source_ref_key unique (source_ref);
alter table deadlines drop constraint if exists deadlines_kind_check;
alter table deadlines add constraint deadlines_kind_check
  check (kind in ('state','tax','domain','insurance','contract','other'));

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

-- Read-only to the anon key; the dashboard writes through /api/ops/contracts
-- (service role, behind its login).
alter table contracts enable row level security;
drop policy if exists "read contracts" on contracts;
create policy "read contracts" on contracts for select using (true);
