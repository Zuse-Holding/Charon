-- ============================================================
-- SELENE OS · migration 002 · executor + approvals server-side
-- Run once in the Supabase SQL editor on a project that already has
-- schema.sql v1.0 applied. supabase/selene_os_schema.sql is updated to match, so a
-- fresh project only needs schema.sql.
-- ============================================================

-- 1. Executor states. 'executing' is the claim agents/executor.py takes
--    before acting, so two runs can never both send the same email.
alter table approval_queue drop constraint if exists approval_queue_status_check;
alter table approval_queue add constraint approval_queue_status_check
  check (status in ('pending','approved','rejected','executing','executed','failed'));
alter table approval_queue add column if not exists result text;  -- what the executor did

-- 2. Idempotency keys. Re-running a job proposes the same thing for the
--    same source (gmail message id, lead id) at most once. NULLs stay
--    distinct, so rows without a source_ref are unaffected.
alter table approval_queue add column if not exists source_ref text;
alter table approval_queue drop constraint if exists approval_queue_source_ref_key;
alter table approval_queue add constraint approval_queue_source_ref_key unique (action_type, source_ref);

alter table leads add column if not exists source_ref text;  -- gmail message id for inbox leads
alter table leads drop constraint if exists leads_source_ref_key;
alter table leads add constraint leads_source_ref_key unique (source_ref);

-- 3. Approvals go through the dashboard's server route (behind its login),
--    not the browser's anon key. With the old policy, anyone holding the
--    anon key could approve a draft — or rewrite its payload and approve
--    it — and the executor would send it.
drop policy if exists "resolve queue" on approval_queue;
