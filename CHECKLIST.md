# Human tasks deferred during Phase 1–4

Things I found that need a decision, a dashboard click, or access I don't have —
tracked here as they come up rather than left buried in commit messages.

## Task 4.3 — already satisfied, confirmed not just assumed

- [x] **Secret found in git history, listed exactly.** One: a Vercel OIDC
  token, in root `.env.local`, committed in `fd66d38` and still tracked at
  HEAD as of the Phase 0 audit. You rotated it; I purged it from all 208
  commits (task A, this session) and re-scanned the rest of history —
  nothing else found.
- [x] **`.env` is gitignored** — confirmed directly in `.gitignore` (line 3).
- [x] **`.env.example` exists** — comprehensive, updated throughout this
  session as new env vars were added (Stripe, rate limits, cost tracking).

## Stripe Dashboard — going live (in progress, 2026-09-15)

Decision made 2026-09-15: skipping the test-mode walkthrough below and
going straight to live mode. Status as of where we stopped for the day:

- [x] Stripe CLI re-authenticated to the real Zuse Holdings account (the
  old "Vitale health sandbox" mismatch is resolved).
- [x] Live-mode restricted key created and set as `STRIPE_SECRET_KEY` in
  `.env` (`rk_live_...`) — Custom permissions: Checkout Sessions (write),
  Customers (write), Customer portal (write), Subscriptions (read). Not
  yet confirmed set in Vercel/Railway — check both before deploying.
- [x] **Live-mode prices confirmed** (2026-09-21/22) — `Basic Tier`
  (`price_1UGALT3AVejqlt1PgDUZKlwb`, $19/mo) and `Pro Tier`
  (`price_1UGALq3AVejqlt1PlvYsShXf`, $49/mo), both recurring monthly, both
  live-mode, both verified directly against the Stripe API. Set in Vercel
  Production as `STRIPE_PRICE_BASIC_MONTHLY` / `STRIPE_PRICE_PRO_MONTHLY` —
  along the way, found and fixed a Vercel typo (`STRIPE_PRICE_BASIC_MONTLY`,
  missing the H) that made the Basic var invisible to the app. Railway not
  yet checked — same values need to land there too.
- [x] **Live webhook endpoint created** (2026-09-22) —
  `we_1UILdp3AVejqlt1Pbg5syUdc`, `https://metisanalytic.com/api/stripe/webhook`,
  all 6 events (`checkout.session.completed`,
  `customer.subscription.created/updated/deleted`,
  `invoice.payment_succeeded/failed`), status `enabled`. Signing secret set
  as `STRIPE_WEBHOOK_SECRET` in Vercel Production. **A fresh deployment is
  needed for this to reach the running app** — Vercel env var changes don't
  hot-apply to already-deployed functions.
- [x] **Customer Portal cancellation set to "at period end"** (2026-09-22)
  — `bpc_1UIM0e3AVejqlt1P5ALaaYnj`, live mode, `is_default: true` so every
  portal session (`web/app/api/stripe/portal/route.ts`) picks it up
  automatically. `customer_update` also allows email changes. Created via
  the Stripe API after granting the CLI key `customer_portal_write`.
- [ ] **Founding-member coupon** (task 1.5), live mode: a promotion code,
  50 redemptions, Pro at $29/mo forever. `allow_promotion_codes` on
  Checkout just lets the customer enter one — the app doesn't create it.
- [x] **Phase 1 schema migration run** (2026-09-22) — see "Database
  (Supabase)" below. This was the one that actually mattered for safety;
  the webhook can now persist `stripe_customer_id`/`tier` on a real payment.
- Verifying an actual live checkout requires a real charge — I won't
  click through that myself or enter payment details on your behalf
  under any circumstances. Once the above is done, the safest path is
  you running one real transaction while I watch the Stripe Dashboard
  and the Supabase `profiles` table update alongside you.

## Database (Supabase)

- [x] **Phase 1 schema migration run and verified** (2026-09-22) — the SQL
  block under "Stripe / billing (Phase 1)" in `supabase/schema.sql`, run by
  you in the Supabase SQL editor. Verified for real afterward, not just
  trusted: queried `profiles` and `stripe_webhook_events` directly through
  the REST API and got HTTP 200 with the new columns present, not a
  "column does not exist" error.
- [x] **Phase 2 duration/cost migration run and verified** (2026-09-22) —
  `research_runs.duration_ms/cost_usd/tier` and `deep_dives.cost_usd` all
  confirmed to exist via a direct REST query (HTTP 200, not a missing-column
  error).

- [x] **pro_grace_expires_at migration run and verified** (2026-09-22) —
  `profiles.pro_grace_expires_at` confirmed via REST. `grant-legacy-pro-grace.mjs`
  can now run.

- [x] **report_issues migration run and verified** (2026-09-22) — table
  confirmed queryable via REST with all expected columns. The "Something
  wrong in this report?" form should no longer 500.

- [x] **Transactional-email migration run and verified** (2026-09-22) —
  `profiles.day7_email_sent_at`/`last_cap_reached_email_at` confirmed via
  REST. De-duplication for the day-7 job and cap-reached email now works.

## Found 2026-09-21 (read-only checks, nothing changed)

- [ ] **Vercel env var typo: `STRIPE_PRICE_BASIC_MONTLY` (missing an H).**
  `web/lib/stripe.ts:38` reads `STRIPE_PRICE_BASIC_MONTHLY`, so the Basic
  price ID in Vercel Production is invisible to the app. Fix while swapping
  in the live price IDs: `vercel env rm STRIPE_PRICE_BASIC_MONTLY`, then add
  the correctly spelled name. `STRIPE_WEBHOOK_SECRET` isn't in Vercel yet
  either (expected — waits on the live webhook endpoint).
- [ ] **Groq's two models may no longer be self-serve.** Secondary sources
  (aggregator pricing blogs, not Groq's own site) say `llama-3.3-70b-versatile`
  and `llama-3.1-8b-instant` moved to enterprise "Contact Sales" pricing on
  2026-08-26. The rates in `model-pricing.ts` do match the last published
  ones ($0.59/$0.79 and $0.05/$0.08 per 1M), so cost_usd isn't wrong for
  past usage, but confirm in console.groq.com that calls to these models
  still work at all.

## Verify before trusting cost_usd numbers

- [ ] **Groq pricing in `src/lib/model-pricing.ts` is a best-effort guess,
  not pulled from a live source.** Tried to fetch Groq's current per-model
  pricing while building this (task C) — the marketing pricing page has no
  pricing table, and the console page requires login, so I couldn't verify
  programmatically. Check `llama-3.3-70b-versatile` / `llama-3.1-8b-instant`
  against console.groq.com's actual current rate card before treating
  cost_usd as accurate for anything real (budgets, margin analysis, etc.).
  OpenRouter's three models are genuinely $0 (they're all `:free`-suffixed)
  and Ollama is genuinely $0 (local) — those two aren't guesses.

## Security — finish the secret-history cleanup (task A)

You rotated the leaked Vercel OIDC token — thank you. The rest of task A is
done except the part that has to be your call:

- [x] Scrubbed `.env.local` out of every commit in history with
  `git-filter-repo --path .env.local --invert-paths --force`, after backing
  up `.git` first. Verified: `git log --all -- .env.local` now returns
  nothing, all 208 commits are still present (just rewritten), working tree
  is unchanged, `origin` re-added.
- [x] Re-scanned all of history for anything else secret (Stripe/AWS/Google
  key patterns, PEM blocks, a real non-default `AGENT_SECRET`, root `.env`,
  `web/.env*`) — all clean, nothing else found.
- [x] `AGENT_SECRET` now has no insecure fallback anywhere — `server/agent-server.ts`
  refuses to start without it; every route that calls the agent server throws
  instead of silently using a default (task A, separate commit).
- [ ] **Force-push the rewritten history, then get everyone else to re-clone.**
  I did not do this myself — rewriting a shared branch's history and telling
  collaborators to discard their clones is exactly the kind of action that
  should be your call, not something to happen as a side effect of a security
  fix. Exact commands:

  ```
  git push origin main --force-with-lease
  ```

  `--force-with-lease` (not plain `--force`) refuses the push if anyone else
  pushed to `origin/main` since your last fetch, so it can't silently clobber
  work you don't know about. If it's refused for that reason, `git fetch` and
  look at what's there before deciding how to proceed — don't just retry with
  plain `--force`.

  Anyone else with a clone (or a fork) needs to **re-clone from scratch**,
  not pull — their local history now diverges from the rewritten one and a
  normal `git pull` will conflict or silently create a mess:

  ```
  cd ..
  rm -rf seline-intel-old   # or wherever their old clone lived — back it up
                             # first if they have uncommitted work in it
  git clone https://github.com/Zuse-Holding/Charon.git
  ```

  If this repo is deployed via a Vercel/Railway integration that tracks a
  specific commit SHA, double-check the deploy still points at a real branch
  ref (`main`) and not a pinned SHA that no longer exists post-rewrite.

  Safety net if anything about the rewrite looks wrong before you force-push:
  a full pre-rewrite backup is sitting at
  `C:\Users\PC\Downloads\seline-intel-git-backup-20260915-053154` (just the
  `.git` folder) and `C:\Users\PC\Downloads\seline-intel-backup-pre-filter-repo-20260915-052944`
  (the whole working copy) — both untouched, neither pushed anywhere. Safe to
  delete once you've confirmed the force-push worked as expected.

## Analytics (task 4.1)

- [ ] **Create a PostHog project and set `POSTHOG_KEY`** (server: agent-server.ts
  and Next.js API routes) **and `NEXT_PUBLIC_POSTHOG_KEY`** (browser — only
  used for `pdf_export`, the one event with no server-side hook since
  `window.print()` runs entirely client-side). Everything no-ops until these
  are set — nothing will break, but nothing will show up in PostHog either.
- [x] Nine events wired: `signup`, `first_research_run`, `research_run`,
  `deep_dive_run`, `watchlist_add`, `pdf_export`, `paywall_hit` (tagged with
  a `cap` slug — 22 call sites across `tierDenied`/`rateLimited` in
  `server/agent-server.ts`, everything from hourly rate limits to Charon-tier
  feature gates), `checkout_started`, `checkout_completed`,
  `subscription_canceled`. All fire server-side except `pdf_export`.
- Found and fixed in passing: `web/app/print/[id]/page.tsx`'s "Export PDF"
  button was an `onClick` handler on a plain element inside an async Server
  Component — not valid in the App Router (event handlers need a Client
  Component boundary). Extracted into `web/app/print/[id]/PrintButton.tsx`
  (`"use client"`), same pattern as the existing `ReportIssueForm` import in
  that file. Couldn't fully exercise this live end-to-end (needs a real
  logged-in session against a real `deep_dives` row — inserted and deleted a
  throwaway test row to confirm the route itself compiles and serves
  correctly; RLS correctly 404s it without a session, as expected).

## Transactional email (task 4.2)

- [ ] **Sign up for Resend and set `RESEND_API_KEY`.** No email provider
  existed anywhere in this codebase before this task (see task B's
  `migration-output/legacy-pro-grace-email.txt`, written but never sendable).
  Resend is a default choice, not one you asked for — picked for being
  low-friction to set up and easy to swap later, same posture Stripe was
  given before real keys existed. Everything no-ops until this is set.
- [ ] **Verify a sending domain and set `EMAIL_FROM`** to
  `"Metis <support@metisanalytic.com>"` — matches `SUPPORT_EMAIL` already in
  `src/lib/email/copy.ts`, so replies to the welcome/cap-reached emails (which
  don't set an explicit `replyTo`) land at the same monitored inbox instead of
  an unmonitored `hello@`. Without a verified domain, Resend's default
  `onboarding@resend.dev` only delivers to your own Resend account email —
  fine for testing the wiring, not for real users.
- [x] **Sender name is generic** — emails are signed `— The Metis team`
  (decided 2026-09-21), and the day-7 email's first-person "I" was changed
  to "we" to match. `src/lib/email/copy.ts` is the single place to edit all
  three emails' copy (subject + body).
- [ ] **Set up the day-7 cron job.** `npm run day7-email-job`
  (`run-day7-email-job.mjs`) needs to run daily — same Railway Cron pattern
  as `run-daily-creator-jobs.mjs`. De-duplication is handled by
  `profiles.day7_email_sent_at` (set the first time it sends), so running
  it more than once a day is safe, just wasteful.
- [x] Welcome email (on signup), day-7 check-in, and cap-reached email
  (cooldown: 7 days, via `profiles.last_cap_reached_email_at`) are all
  wired for real — not stubbed. Cap-reached only fires on caps with a real
  self-serve upgrade path (research/deep-dive quotas, Deep Dive access,
  export access); Charon-only gates, rate limits, and the expired-trial
  message don't send one, since "upgrade to Pro" wouldn't fix those.
- Couldn't verify: no Resend account exists to test an actual delivered
  email against (subject line, spam score, rendering in a real inbox).
  Confirmed via a live curl against a running agent-server that
  `/email/welcome` responds `{ ok: true, sent: false }` when
  `RESEND_API_KEY` is unset — the no-op path works; the send path itself
  is unverified past what Resend's own SDK guarantees.

## Hosting / infra

- [ ] **Verify production env vars.** Confirm Vercel and Railway/VPS both have
  a real (non-default) `AGENT_SECRET`, and once ready, the real Stripe keys —
  none of this can be checked from the repo.
- [ ] **DB backups (task 4.5)** — not visible from the repo at all; needs
  checking directly in Supabase Dashboard → Settings → Database → Backups:
    - Confirm daily backups are actually enabled (they're on by default on
      paid Supabase plans, but this project's plan tier isn't visible from
      the repo either — verify, don't assume).
    - Point-in-Time Recovery (PITR) needs its own opt-in and a paid add-on
      — worth turning on given this app holds paying customers' billing
      state (`profiles.stripe_*`) and research history; a once-a-day
      backup means up to 24 hours of data loss on a bad day, PITR narrows
      that to minutes.
    - Note the retention window (how many days of backups are kept) —
      that's a real number to know before you need it, not after.
  - [x] **Local restore-test script written** — `restore-test.mjs`
    (`npm run restore-test`), takes `BACKUP_FILE` (a pg_dump export from
    the dashboard) and `RESTORE_TARGET_DATABASE_URL` (a disposable scratch
    Postgres — never point this at anything real), restores it via
    `pg_restore`/`psql`, and checks that the core tables actually came
    back with rows in them. Two safety guards, both live-tested: refuses
    to run if the target host matches this project's real Supabase URL,
    and refuses to restore on top of a database that already has this
    app's tables in it.
  - Couldn't fully verify: no real backup file exists to test the restore
    path itself against (only the argument-validation and safety-guard
    paths, which I did run — both behave correctly). Get an actual backup
    export from the Supabase dashboard and a throwaway Postgres instance
    (a local `docker run postgres`, or a second scratch Supabase project)
    to run this for real before trusting it as a verified recovery path.
- [ ] **Legal review flag** — `LEGAL_PAGES_FINAL` (Phase 2.5) stays `false`
  until an attorney has actually reviewed Terms/Privacy. Flipping it is a
  business decision, not a code change.

*(This file grows as later phases surface more human-only tasks.)*
