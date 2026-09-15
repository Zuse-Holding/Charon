# Metis — Commercial-Launch Audit (Phase 0)

Read-only investigation. No code changed. Findings verified directly against the
codebase and git history as of 2026-09-14, not against docs/roadmaps (several of
which are stale — see prior session notes).

---

## 🔴 Flagging immediately, out of numbered order

**A real secret is currently committed and tracked in this public GitHub repo.**
Root-level `.env.local` contains a live `VERCEL_OIDC_TOKEN` (a ~1200-character
token), committed in `fd66d38` (2026-06-30) and **still tracked in HEAD today** —
confirmed via `git ls-files`. `.gitignore` already lists `.env.local` and
`.env*.local` (lines 17–18), but the file was added *before* that rule existed, so
the ignore never took effect — the same "tracked-before-ignored" bug found and
fixed for `.next/` and `*.tsbuildinfo` in an earlier cleanup pass.

Risk assessment: Vercel OIDC tokens are short-lived by design (typically minutes),
so a token committed 2.5 months ago is very likely already expired and not
independently exploitable today. That does not make committing it fine — I'm
flagging this now rather than waiting for Phase 4.3, since untracking a file is a
zero-risk, one-line fix, separate from anything requiring your judgment. Recommend:
`git rm --cached .env.local` in Phase 1 or sooner, your call. Full history scan
(Stripe/AWS/Google keys, private key blocks, a real `AGENT_SECRET`, root `.env`,
`web/.env*`) found nothing else — see §6 for the full scan record.

---

## 1. Auth

- **Method:** Email+password and Google OAuth, both via Supabase Auth
  (`web/app/login/page.tsx`, `web/app/auth/callback/route.ts`). No magic link.
- **Email verification:** Not enforced in application code. On signup, the app
  checks whether Supabase returns a session immediately — if yes, confirmation
  wasn't required (or Supabase's project setting has it off); if no, it shows
  "check your email." **This means email verification is entirely controlled by
  a Supabase Dashboard toggle (Authentication → Providers → Email → Confirm
  email), which I cannot read from the repo.** Verify this setting directly —
  if it's off, anyone can sign up with an email they don't own.
- **One account per email:** Enforced by Supabase Auth itself (unique email
  constraint) — not something our code needs to add.
- **Password reset:** Present and appears complete — `handleForgotPassword()`
  sends a reset email via `resetPasswordForEmail`, and a `PASSWORD_RECOVERY`
  auth-state listener swaps the login card into a "set new password" form
  (`web/app/login/page.tsx:150-171`). Minimum password length (8 chars) enforced
  client-side only on the *reset* form — the *signup* form has no minimum-length
  check at all (only "email and password required").
- **Session expiry:** Not customized — relies on Supabase's default JWT/refresh
  cookie behavior. The one deviation is the "Remember me" checkbox
  (`web/lib/supabase/client.ts`): unchecked, it drops the cookie's Max-Age so it
  becomes a session cookie (cleared on browser close) instead of the library's
  400-day default. No server-side idle/absolute session timeout beyond that.

## 2. Billing

**Code that exists** (built and typechecked last session, not yet deployed):
- `web/app/api/stripe/checkout/route.ts` — Checkout Session creation, plan →
  price ID via env vars, reuses existing `stripe_customer_id` if present.
- `web/app/api/stripe/portal/route.ts` — Billing Portal session.
- `web/app/api/stripe/webhook/route.ts` — signature verification present
  (`stripe.webhooks.constructEvent`, rejects on failure). Handles exactly:
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
- `web/middleware.ts` carves the webhook path out of the login-redirect gate
  (Stripe has no session cookie) — this was a real bug caught by testing, now
  fixed.

**What's missing for production** (all real gaps, not stylistic):
- `invoice.payment_succeeded` and `invoice.payment_failed` are **not handled at
  all**. Task 1.3/1.4's past_due-banner and dunning flow have nothing to key off
  today beyond the coarser `customer.subscription.updated` status field.
- **No idempotency.** The webhook does not store processed Stripe event IDs
  anywhere — no such table exists in `supabase/schema.sql`. A Stripe retry
  (which happens routinely, e.g. if our handler 200s slowly) would reprocess the
  event. Low-risk today since handlers are mostly idempotent writes, but not
  guaranteed, and task 1.3 explicitly asks for this.
- **Schema not applied.** `stripe_customer_id`, `stripe_subscription_id`,
  `stripe_price_id`, `subscription_status`, `current_period_end`,
  `cancel_at_period_end` are proposed in `docs/stripe-integration-plan.md` but
  **do not exist in `supabase/schema.sql`** — confirmed via grep, zero matches.
  Every webhook write to these columns will fail against the live database
  until this migration is actually run.
- **No real Stripe keys/price IDs configured anywhere** (local `.env`/`web/.env`
  have none; presumably same in Vercel/Railway — unverified, dashboard access
  needed).
- Pricing-page buttons still just link to `/login?mode=signup` with no plan
  carried through — nothing calls `/api/stripe/checkout` yet from the UI.
- Settings page (`web/app/settings/page.tsx:358`) still shows a "Contact us to
  upgrade" `mailto:` link — no live upgrade or "Manage billing" button.

**Where plan state lives / how limits are enforced:** `profiles.tier` (plain
text column: `internal | team | pro | basic | free | trial`), read by
`getUserTier()` in `server/agent-server.ts:147`, defaulting anyone with no tier
set to `"basic"`. Every tier-gated feature checks `getTierConfig(tier)` from a
hardcoded `TIER_CONFIG` map in the same file — **entirely server-side**, nothing
client-trusted for enforcement (the client-side `tier-context.tsx` is for
displaying limits/UI state, not gating).

**Team tier:** exists in `TIER_CONFIG` and is currently single-user, identical to
Pro with higher limits — the multi-seat workspace feature it implies doesn't
exist (`docs/team-features-scoping.md` confirms this is "scoping only, not
built"). Relevant directly to task 1.6's instruction to hide Team from Checkout.

## 3. Research pipeline

- **Endpoint:** `POST /api/research` (`web/app/api/research/route.ts`), which in
  production (when `AGENT_SERVER_URL` is set) proxies to the Railway/VPS agent
  server's own `/research` route (`server/agent-server.ts`).
- **Rate limiting:** An in-memory `Map<userId, {count, resetAt}>` in
  `web/app/api/research/route.ts`, 20 runs/hour per user, admin bypass via an
  **empty** `ADMIN_USER_IDS` set (line 34 — literally nobody is in it, including
  you). **Important caveat: this is a plain in-memory Map inside a Next.js API
  route running on Vercel serverless infrastructure.** Serverless function
  instances are ephemeral and can scale to multiple concurrent instances, each
  with its own independent memory — this limiter's count is *not* guaranteed
  to be shared or persistent across invocations in production. It will
  meaningfully throttle a single sustained session hitting a warm instance, but
  it is not a reliable global per-user cap the way a database or Redis-backed
  counter would be. Worth knowing before treating "20/hour" as an enforced
  guarantee.
- **Per-IP protection:** None at all. The route requires authentication before
  any rate-limit check runs, so there's no path to hit it unauthenticated — but
  there's also no limit on account *creation* itself (see §1), so per-IP
  protection is effectively absent for a determined multi-account abuser.
- **Separately, server-side quota enforcement** (independent of the above,
  and more reliable since it's DB-backed): `server/agent-server.ts` enforces
  `dailyResearchLimit`, `monthlyResearchLimit` (Basic-only, 25/mo), and a
  separate 25/month cap specifically on person-search, all queried from
  `research_runs`/`profiles` per request — this part is durable across
  serverless instances since it reads from Supabase, not memory.
- **Duration/cost logging:** `research_runs` (the quick-profile table) has
  **no duration or cost column at all** (`supabase/schema.sql:7-18`).
  `deep_dives` **does** have `duration_ms` (line 38) but still no cost column.
  Nothing anywhere logs token usage or per-run dollar cost. Task 2.3 is
  building this from near-zero, not extending an existing log.

## 4. Sources/citations

- Every agent's output type includes a `sources: Source[]` field
  (`src/types/research.ts` — `Source` interface with `url`/`title`, used in
  ~20 places across agent output shapes).
- `report-agent` (`src/agents/report-agent/index.ts`) renders exactly **one
  flat "## Sources" heading at the very end of the whole report**, numbering
  every source from every section into a single combined list
  (lines 156–163, and three more identical blocks for other report types) —
  e.g. `1. [title](url)`. This is not per-claim and not even cleanly
  per-section (a reader can't tell which source backs which section, since
  they're merged into one undifferentiated list at the bottom).
- The web report view renders this as plain Markdown (no special citation
  component) — so today a source list exists but with zero attribution
  granularity. This is the case in task 3.3(b), but flatter than "per
  section" — it's genuinely just "per report."

## 5. Where things live (for editing in later phases)

| Content | File |
|---|---|
| Pricing tiers/copy (marketing `/pricing`) | `web/app/pricing/page.tsx` (`PLANS`, `COMPARE_ROWS`, `FAQS`) |
| Pricing tiers/copy (**also** duplicated on homepage) | `web/app/page.tsx` (`PRICING` array, line 52) — **two places, not one** |
| Homepage stats incl. "~30s" | `web/app/page.tsx` line 191 (`statsBar` array) |
| Terms draft label | `web/app/terms/page.tsx` |
| Privacy draft label | `web/app/privacy/page.tsx:14` — hardcoded JSX string today, not a flag |
| Case studies placeholder page | `web/app/case-studies/page.tsx` |
| Case studies nav link | `web/components/marketing/MarketingShell.tsx` |
| Case studies in sitemap | `web/app/sitemap.ts` |

## 6. Security basics

- **Secrets from env:** Yes, consistently — no hardcoded API keys found in the
  current working tree.
- **Git history secret scan** (via `git log -G<pattern> --all`, since gitleaks
  isn't installed locally):
  - 🔴 **`.env.local` with a real `VERCEL_OIDC_TOKEN` — currently tracked in
    HEAD.** See the flag at the top of this document.
  - Root `.env`, `web/.env`, `web/.env.local` — never committed, clean.
  - Stripe (`sk_live_`/`sk_test_`), AWS (`AKIA...`), Google (`AIza...`),
    PEM private-key blocks, a real (non-blank) `AGENT_SECRET` — zero hits
    across all of history.
  - The only historical `AGENT_SECRET=` line is the blank placeholder in
    `.env.example` from the initial commit — not a leak.
- **DB backups:** Cannot verify from the repo — this is a Supabase project
  dashboard setting (Settings → Database → Backups). Needs a human check.
- **HTTPS:** Not configured in application code, but Vercel auto-provisions
  and enforces TLS for custom domains by default — very likely fine, just not
  something our code controls either way.
- **HSTS / CSP / X-Content-Type-Options / X-Frame-Options:** **None
  configured anywhere.** `web/next.config.ts` has no `headers()` function;
  `vercel.json` has no `headers` block. Zero security headers beyond
  whatever Vercel's platform default is (which does not include CSP or
  frame-ancestors).

## 7. Analytics

**None.** No PostHog, GA, Vercel Analytics, Mixpanel, or Segment dependency in
`web/package.json`. Zero visibility into signups, funnel drop-off, or feature
usage today.

## 8. Email

**Only Supabase Auth's own built-in transactional email** — confirmation and
password-reset emails, sent via whatever mail configuration is set in the
Supabase project (default Supabase mailer unless a custom SMTP provider was
configured in the dashboard — unverified from repo). **No product-side email
provider exists anywhere in the codebase** — no Resend, SendGrid, Postmark,
Mailgun, or SMTP client installed or referenced. `profiles.notification_preferences`
exists as a column but nothing currently sends notification emails based on it.
Welcome emails, day-7 emails, and cap-reached emails (Phase 4.2) would be built
from zero, including picking and wiring a provider — that's a decision, not
just an implementation detail (see Open Decisions below).

---

## Open decisions before Phase 1 (flagging now, per your instructions)

1. **Email provider for Phase 4.2** isn't specified in the brief — Resend,
   Postmark, SendGrid, or SMTP-via-Supabase all fit "plain text, from a human
   name." Need a choice (and an API key) before that phase can ship.
2. **Free tier doesn't exist in `TIER_CONFIG` as "the plan a canceled Pro/Basic
   user downgrades to."** The webhook I wrote downgrades cancellations to
   `"basic"` specifically because a separate, more-restricted `"free"` tier
   already exists in `TIER_CONFIG` with different (lower) limits than what
   task 1.6 specifies for Free (3 lifetime profiles, 1 watchlist, no PDF) —
   the *existing* `"free"` tier config has different numbers (3/day, not 3
   lifetime; 2 watchlist, not 1). Task 1.6's Free spec doesn't match the
   `"free"` tier already in the codebase. Need your call on whether to
   redefine the existing `free` tier to match, or whether `"free"` should
   remain distinct and cancellations go somewhere else.
3. **`monthlyResearchLimit` today resets on a fixed calendar-style "billing
   anchor" derived from account creation date** (see `getBillingPeriodStart`
   in `server/agent-server.ts`, per its own comments) — not yet tied to
   `current_period_end` from an actual Stripe subscription, since that column
   doesn't exist yet. Task 1.6 wants resets keyed to the real Stripe period.
   This is a natural fit once the schema migration lands, flagging so it's
   understood as sequenced (schema first, then this reset logic changes).

Nothing else found that contradicts the brief's assumptions. Stripe integration
being "built and tested but not deployed" checks out — code exists, compiles,
and was smoke-tested against a local dev server, but has no schema, no real
keys, no idempotency, and two of six required webhook events unhandled.

Waiting for confirmation before starting Phase 1.
