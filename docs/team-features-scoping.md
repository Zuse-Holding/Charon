# Team Features — Scoping Doc

Status: **scoping only** — no schema applied, no UI built. This is the "bones" for Team tier to become a real multi-seat product instead of a single-user account with a bigger quota, per the 7/17 weekend list (#6).

## Where things stand today

`Team` already exists as a tier (`server/agent-server.ts` `TIER_CONFIG.team`) but it behaves exactly like Pro with higher limits — one `auth.users` row, one `profiles` row, everything scoped to `user_id`. There is no concept of more than one person sharing an account's research, watchlist, or KG. Every table (`research_runs`, `watchlist`, `deep_dives`, `kg_entities`, `kg_relationships`) is keyed and RLS-scoped to a single `user_id`.

There's also no billing system (confirmed during the Basic-tier gate work — no Stripe, no subscription table anywhere), so "how many seats does this workspace pay for" has no source of truth yet. That's a real gap this doc flags but doesn't solve — see Open Questions.

## Goal

A `workspace` becomes the unit teams share: multiple users, one shared watchlist, visibility into each other's research runs (at minimum), and eventually a shared Knowledge Graph. Personal accounts (Basic/Pro/Free) are unaffected — a workspace is additive, not a replacement for the existing per-user model.

## Data model (proposed, not applied)

```sql
-- A workspace is the team container. owner_id is the account that pays /
-- administers it; membership (including the owner) lives in workspace_members.
CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  owner_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Membership + role. role is deliberately minimal (owner/admin/member) —
-- granular permissions are a v2 problem, not needed for a first ship.
CREATE TABLE IF NOT EXISTS workspace_members (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  invited_by   UUID        REFERENCES auth.users(id),
  joined_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

-- Pending invites — separate from membership so an invite can exist
-- before the invitee has an account, and expires cleanly.
CREATE TABLE IF NOT EXISTS workspace_invites (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  role         TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by   UUID        NOT NULL REFERENCES auth.users(id),
  token        TEXT        NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Nullable team_id added to existing tables — NULL means "personal", set
-- means "shared with this workspace". Additive: a Team-tier user can still
-- run personal (non-shared) research by leaving it NULL, e.g. before
-- deciding to share a result with the team.
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE kg_entities    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;
ALTER TABLE kg_relationships ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

-- Team watchlist — separate table rather than overloading `workspace_id`
-- onto the existing personal `watchlist` table. Keeps "my watchlist" and
-- "the team's watchlist" as genuinely different lists a user can have
-- both of, instead of collapsing them into one with confusing ownership.
CREATE TABLE IF NOT EXISTS team_watchlist (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type                  TEXT        NOT NULL CHECK (type IN ('company', 'person', 'product', 'political')),
  subject               TEXT        NOT NULL,
  added_by              UUID        NOT NULL REFERENCES auth.users(id),
  added_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed_at     TIMESTAMPTZ,
  refresh_interval_days INTEGER     DEFAULT 3,
  UNIQUE (workspace_id, subject, type)
);
```

### RLS shape

Per-user RLS (`auth.uid() = user_id`) stops being sufficient once a row can belong to a workspace instead of a single user. The pattern becomes "user_id = me OR I'm a member of this row's workspace":

```sql
CREATE POLICY "Users manage own or workspace research runs"
  ON research_runs FOR ALL
  USING (
    auth.uid() = user_id
    OR workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    OR workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
```

Same shape applies to `kg_entities`/`kg_relationships`. `team_watchlist` RLS is simpler (membership-only, no personal-row branch since the table only ever holds shared rows).

## API surface (rough plan)

New Next.js routes, following the existing `web/app/api/*` → agent-server pattern:

- `POST /api/workspaces` — create a workspace (Team tier only, one owned workspace per account to start — no nested/multi-workspace ownership in v1).
- `GET /api/workspaces/:id` — workspace details + member list.
- `POST /api/workspaces/:id/invite` — owner/admin invites by email, writes `workspace_invites`, sends an email (reuses whatever transactional-email path Settings' password-reset flow already has, or falls back to a `mailto:` link the owner sends manually if no transactional email is wired up yet — worth checking before building this).
- `POST /api/workspaces/invites/:token/accept` — creates the `workspace_members` row, deletes the invite.
- `DELETE /api/workspaces/:id/members/:userId` — owner/admin removes a member.
- `GET /api/workspaces/:id/watchlist`, `POST /api/workspaces/:id/watchlist`, `DELETE .../watchlist/:id` — team watchlist CRUD, mirrors the existing personal watchlist routes.
- Research runs: no new route needed — extend the existing `POST /api/research` body with an optional `workspaceId`, so "run this and share it with the team" is one flag on the request the frontend already makes, not a separate endpoint.

### External API access (mentioned in the ask, "rough plan")

No OAuth server, no public API docs today — this would be new surface, not an extension of something existing. Simplest version that could ship:

- `api_keys` table: `id, workspace_id, key_hash, label, created_by, created_at, last_used_at, revoked_at`. Store a hash, not the raw key (same principle as password storage) — show the raw key once at creation time only.
- A `x-api-key` header, checked in a thin middleware ahead of the existing agent-server routes, resolving to a workspace + acting-as-owner permissions (not a specific member — keys are workspace-level, not personal).
- Reuse the existing rate-limit map pattern in `web/app/api/research/route.ts`, keyed by API key instead of user id.
- Gate entirely on Team tier (`config.adminAccess`-style boolean, e.g. a new `apiAccess` flag) so this doesn't need to be reasoned about for Basic/Pro at all.

This is enough surface for a partner/integration use case (trigger a research run from an external system) without committing to a full public API product yet.

## Phased rollout

1. **Schema + solo-provision, no UI.** Apply the tables above. Every existing Team-tier account gets one `workspaces` row auto-created (name defaulted to something like "{email}'s Workspace") with themselves as owner — this means the schema ships without forcing an immediate UI build, and later UI work has real data to point at from day one instead of a cold start.
2. **Invite + shared watchlist.** Invite flow, member list, team watchlist UI (a second tab/section next to the personal watchlist). No shared research runs yet.
3. **Shared research runs + KG.** The `workspaceId` flag on `/api/research`, a "shared with team" indicator in the run list, workspace-scoped KG view.
4. **Roles/permissions + API keys.** Admin vs member distinctions actually enforced (today's schema has the `role` column but phase 2–3 doesn't need to check it yet — a flat "any member can do anything" model is fine until this phase), external API key issuance.

## Open questions (need a decision before phase 1 ships)

- **Seat billing.** There's no billing system at all right now (same gap the Basic-tier 25/month cap hit). A workspace with 5 members and Team tier's `dailyResearchLimit: 200` — is that 200 total for the workspace, or 200 per member? The schema above doesn't presuppose an answer; the limit-checking logic in `agent-server.ts` would need a `getWorkspaceUsage` analog to `getMonthlyResearchUsage`, keyed by `workspace_id` instead of `user_id`, once this is decided.
- **One workspace per account, or many?** This doc assumes one owned workspace per Team-tier account for simplicity. If a user needs to belong to multiple workspaces (e.g. consultant working with several client teams), `workspace_members` already supports it (no uniqueness constraint on `user_id` alone) — but the UI/API plan above assumes single-workspace-context and would need a workspace switcher if that's wrong.
- **KG merge semantics.** `kg_entities` dedupe on `(user_id, name, type)` today. Once `workspace_id` exists, does a shared entity dedupe across the whole team, or does each member still get their own personal entity even when the research run was shared? The upsert key would need to become `(COALESCE(workspace_id, user_id), name, type)` or similar — not just an added nullable column with no dedupe-key change.
- **Removal semantics.** If a member is removed from a workspace, do their previously-shared `research_runs`/`kg_entities` stay in the workspace (become team-owned) or leave with them? `ON DELETE SET NULL` on `workspace_id` in the schema above assumes they stay (safest default — no silent data loss for the rest of the team), but this should be a conscious call, not an accident of the FK choice.
