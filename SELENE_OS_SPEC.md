# SELENE OS — Business Operations Spec
### Zuse Holdings · Handoff document for Claude Code
### v1.0 · July 2026

---

## 1. What this is

Selene OS is the operational core of Zuse Holdings. Selene is the agent that runs the
business side — finances, email, leads, compliance — and the dashboard is her instrument
panel. Nick interacts with Selene; Selene delegates research and enrichment to Charon.
Nothing irreversible happens without Nick's approval.

**Prime directive: agent proposes, Nick disposes.** Every consequential action Selene wants
to take becomes a row in an approval queue. Her worst possible day is a queue full of drafts
that get rejected. This constraint is what makes the system trustworthy enough to run daily.

**Persona hierarchy (carried over from the existing Selene/Charon build):**
- **Selene** — orchestrator and the only voice Nick sees. Warm, quick, direct. Head of
  household energy. All dashboard copy, briefs, and notifications are written in her voice.
- **Charon** — subordinate research/vetting specialist. Clinical, precise, never addresses
  Nick directly. His output is always routed through Selene. Used for lead enrichment,
  vendor research, and any "who/what is this" question.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  DASHBOARD (Next.js on Vercel)                          │
│  Reads/writes Supabase · renders approval queue,        │
│  ledger, leads, deadlines, weekly brief                 │
└───────────────▲─────────────────────────────────────────┘
                │ (Supabase JS client, RLS-protected)
┌───────────────┴─────────────────────────────────────────┐
│  SUPABASE (single source of truth)                      │
│  approval_queue · ledger · leads · deadlines ·          │
│  inbox_triage · briefs · selene_facts · agent_runs      │
└───────────────▲─────────────────────────────────────────┘
                │ (service-role key, server-side only)
┌───────────────┴─────────────────────────────────────────┐
│  SELENE AGENT (Claude Agent SDK, Python)                │
│  Runs on schedule (cron) — Pi rack or any always-on box │
│  Tools: Gmail MCP · Supabase writes · Charon subagent   │
│  Approval gate: can_use_tool hook blocks irreversible   │
│  actions → writes to approval_queue instead             │
└─────────────────────────────────────────────────────────┘
```

**Key decisions:**
- Supabase is the only shared state. Agent and dashboard never talk to each other directly.
- The agent runs headless on a schedule (see §6). No long-running daemon needed for v1.
- The existing SQLite `selene_memory.db` facts migrate into a `selene_facts` table so
  memory lives where both the agent and dashboard can see it.
- Model: Sonnet-class for routine triage runs (cheap, fast), Opus/Fable-class only for the
  weekly brief and lead enrichment where judgment quality matters. Configurable per module.
- The Anthropic model is abstracted behind the agent layer — Selene is the brand, the
  engine is swappable. Same philosophy as the widget builds.

---

## 3. Modules

### 3.1 Inbox — triage + drafting  (Tier 1, build first)
- On each run, pull unprocessed messages via Gmail MCP (track last-seen message id in
  `agent_runs`).
- Classify each into buckets: `lead` / `vendor` / `legal_important` / `personal` / `noise`.
- Write one row per message to `inbox_triage` with a one-line summary.
- For anything needing a reply: Selene writes the draft, inserts an `approval_queue` row
  with `action_type = 'send_email'` and the full draft in `payload`.
- **Hard rule: the agent never sends email.** Approval → a separate executor step sends it
  (or v1: approval surfaces a "open in Gmail with draft" flow, executor comes in v1.1).
- Lead-smelling emails also spawn a row in `leads` (see 3.3).

### 3.2 Finance — ledger + burn  (Tier 1)
- Manual-first, deliberately. **No Plaid/bank feeds in v1** — high effort, sensitive data,
  and the manual ledger captures ~90% of value at this stage.
- Inputs: (a) quick-add form on the dashboard, (b) receipts/invoices forwarded to a
  dedicated address that Selene parses from the inbox run into proposed ledger entries
  (approval-gated, `action_type = 'add_ledger_entry'`).
- `recurring_costs` table seeds the known burn: domains (metisanalytic.com), Supabase,
  Vercel, Groq, Serper, Anthropic API, hosting.
- Every entry carries: venture tag (`zuse` / `metis` / `charon` / `lounge` / `personal-mixed`),
  category, and a `deductible` flag — mapping directly to the startup-expense/deduction
  framework already worked out. Tax season becomes an export button.
- Dashboard: monthly burn number, category breakdown, per-venture split, runway note.

### 3.3 Leads — pipeline + enrichment  (Tier 2 plumbing, build now, lights up with Metis)
- Sources: contact/signup form on metisanalytic.com posting straight into `leads`
  (Supabase edge function or API route), plus inbox triage flagging.
- New lead → Selene delegates to **Charon** for an enrichment pass: who is this, company,
  role, plausibility, suggested angle. Result stored in `leads.enrichment` (jsonb) with a
  0–100 score. Charon's write-up is clinical; Selene's surfacing of it is not.
- Selene drafts the first-touch reply → approval queue.
- Status flow: `new → enriched → contacted → replied → qualified → closed/dead`.
  Every transition logged in `lead_events`.

### 3.4 Compliance clock  (Tier 1, deterministic — no LLM in the loop)
- Seeded deadlines: CA Statement of Information, CA annual franchise tax, domain renewals,
  registered-agent/insurance renewals as they exist.
- Pure date math. Anything inside 30 days is surfaced on the dashboard and included in the
  weekly brief; inside 7 days it goes red. Recurrence handled in-table.
- This module must work even if every LLM call fails. It's the one that bites hardest.

### 3.5 Weekly brief  (Tier 2)
- Sunday evening run. Selene compiles: inbox stats + anything unanswered and important,
  burn vs. last month, lead movement, deadlines inside 30 days, and one candid observation
  (things stalling, costs creeping, a lead going cold).
- Stored in `briefs` as markdown + a stats jsonb blob; rendered as the dashboard landing
  card for the week; optionally emailed (via the same approval-gated send path until
  trusted, then allowlisted as auto-send to Nick's own address only).
- Voice: Selene. Plainspoken, direct, no corporate filler.

---

## 4. Reliability rules (non-negotiable)

1. **Approval gate on everything irreversible.** Send email, spend money, contact a lead,
   delete anything → `approval_queue`. Enforced in code via the agent's permission hook,
   not via prompt instructions alone.
2. **Idempotent runs.** Every module tracks a cursor (last message id, last run timestamp)
   in `agent_runs`. Re-running a failed job must never duplicate triage rows, ledger
   proposals, or drafts.
3. **Fail loud, degrade gracefully.** A failed run writes `status='failed'` + error to
   `agent_runs` and shows a status chip on the dashboard. Compliance clock and dashboard
   reads never depend on the agent being alive.
4. **Least-privilege tools per module.** The inbox run gets Gmail read + Supabase write to
   its own tables — nothing else. Allowlists live in the agent config (see agents/selene.py).
5. **Log everything.** Every run: tokens, cost, actions proposed, duration. Selene reports
   her own API spend into the ledger monthly. The business agent pays rent like everyone else.
6. **Prompt-injection posture.** Email content is untrusted input. The triage prompt treats
   message bodies as data to classify, never as instructions; drafts are always
   human-approved, which is the real backstop.

---

## 5. Dashboard — design system

Same house as Life Hub and the Charon terminal. Near-black, high contrast, data-forward.

**Accessibility constraint (hard requirement): no purple/violet anywhere, no pastels,
no low-saturation accents. Partial color blindness — purple reads as blue, pastels wash out.**

Tokens:
```
--bg:        #0A0A0B   (near-black, matte)
--surface:   #121215   (cards)
--line:      #26262B   (borders, dividers)
--text:      #EDEDEF
--text-dim:  #8A8A93
--selene:    #22D3EE   (cyan — Selene's color: nav, brief, her voice, focus rings)
--ember:     #F97316   (orange — primary actions, approval queue, alerts pending)
--ok:        #22C55E   (green — approved, paid, on-track)
--danger:    #EF4444   (red — overdue, rejected, failed runs)
--charon:    #F59E0B   (amber — reserved for Charon enrichment blocks only)
```
Type: **Inter** for UI, **JetBrains Mono** for all numbers, money, dates, ids. Money and
dates are always mono — data reads as data.

**Signature element:** the **Selene status ring** — a thin cyan moon-phase ring in the
header. Full ring = all runs green; waning/gapped = pending approvals or a failed run;
the gap is drawn proportional to open queue items. One glance = system health. (Reuse the
radial-ring pattern from Life Hub's Today Score.)

Layout (single page, four zones):
```
┌────────────────────────────────────────────────┐
│ SELENE OS ◐            burn · leads · runs ✓   │  header + status ring
├──────────────────────────────┬─────────────────┤
│ APPROVAL QUEUE (ember)       │ THIS WEEK       │  queue = the heart, top-left
│ [draft cards: approve/reject]│ (Selene's brief)│
├──────────────┬───────────────┼─────────────────┤
│ FINANCE      │ LEADS         │ DEADLINES       │
│ burn, split  │ pipeline cols │ 30-day clock    │
├──────────────┴───────────────┴─────────────────┤
│ INBOX TRIAGE (collapsible table, bucket chips) │
└────────────────────────────────────────────────┘
```
Approve/reject are one-tap with an undo toast (undo flips the row back within 10s; after
execution there is no undo — say so in the UI). Mobile: zones stack, queue first.

Copy rules: everything user-facing is in Selene's voice — sentence case, plain verbs,
buttons say what happens ("Send reply", "Add to ledger", not "Submit"). Empty queue state:
"Nothing needs you. I'll flag it when something does."

---

## 6. Scheduling (v1)

| Job            | Cadence                | Module(s)              |
|----------------|------------------------|------------------------|
| inbox run      | every 2h, 7am–9pm      | 3.1 + lead flagging    |
| finance sweep  | daily 8pm              | 3.2 (parse forwards)   |
| enrichment     | on new lead (or w/ inbox run) | 3.3 (Charon)    |
| compliance     | daily 7am (pure code)  | 3.4                    |
| weekly brief   | Sunday 6pm             | 3.5                    |

Plain cron on the Pi rack (or any box) calling `python -m agents.selene <job>`. No queue
infra needed at this scale. Add Conductor later only if job volume earns it.

---

## 7. Build order

**Phase 1 — the spine (target: first working weekend)**
1. Supabase project + `supabase/schema.sql` applied.
2. Dashboard scaffold: Next.js + tokens + the four zones reading live tables (empty states).
3. Compliance clock seeded and rendering (no LLM — instant win, real value day one).
4. Manual ledger add + recurring costs seeded → burn number is real.

**Phase 2 — Selene comes online**
5. Agent skeleton (`agents/selene.py`) with the approval gate proven: inbox run classifying
   into `inbox_triage` + drafting into `approval_queue`.
6. Approval queue UI live: approve/reject writing back, "open draft in Gmail" flow.
7. `agent_runs` status chip + Selene status ring wired to real data.

**Phase 3 — pipeline + voice**
8. Leads table + metisanalytic.com form endpoint + Charon enrichment pass.
9. Weekly brief generation + landing card.
10. Approved-email executor (real send on approve), Selene's API-cost self-reporting.

**Deliberately out of scope for v1:** bank feeds/Plaid, auto-send without approval,
multi-user auth (single user: Nick), mobile app (responsive web + PWA is enough),
voice interface (later — the rack build already points there).

---

## 8. Environment

```
ANTHROPIC_API_KEY=            # agent
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=    # agent only — never shipped to the dashboard client
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
GMAIL_*                       # per Gmail MCP server config
SELENE_MODEL=claude-sonnet-4-6
SELENE_BRIEF_MODEL=           # heavier model for briefs/enrichment, optional
```

Single-user RLS: anon/authenticated role is read-mostly + approval writes; all agent
writes go through the service role server-side. Keys live on the agent box and in Vercel
env — never in the repo.

---

## 9. Files in this package

```
SELENE_OS_SPEC.md          ← this document
CLAUDE.md                  ← drop in repo root; instructions for Claude Code
supabase/schema.sql        ← full schema, ready to run
agents/selene.py           ← Agent SDK skeleton: Selene + Charon + approval gate
.env.example
```

Selene runs the house. This is the house.
