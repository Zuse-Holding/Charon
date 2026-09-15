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

## Stripe Dashboard

- [ ] **Set Customer Portal cancellation to "at period end."** Task 1.2 requires
  cancel-at-period-end behavior. This is a Stripe Dashboard setting (Settings →
  Billing → Customer portal → Subscriptions → Cancellations → choose "At end of
  billing period," not "Immediately"), not application code — the portal session
  the app creates uses whatever the dashboard's active configuration says. Verify
  this is set before relying on it; it's not something `web/app/api/stripe/portal/route.ts`
  can enforce on its own.
- [ ] **Create the Basic and Pro products/prices** (test mode first): $19/mo and
  $49/mo recurring. Copy their `price_...` IDs into `STRIPE_PRICE_BASIC_MONTHLY`
  / `STRIPE_PRICE_PRO_MONTHLY`. Do not create a Team price — it's not sold.
- [ ] **Founding-member coupon** (task 1.5): create a promotion code in the
  Stripe Dashboard — 50 redemptions, Pro at $29/mo forever. The app supports
  `allow_promotion_codes` on Checkout; it does not create the coupon itself.
- [ ] **Webhook endpoint**: for local testing use the Stripe CLI
  (`stripe listen --forward-to localhost:3000/api/stripe/webhook`); only add a
  real Dashboard webhook endpoint (`https://metisanalytic.com/api/stripe/webhook`)
  when actually deploying live keys.

- [ ] **Resolve the Stripe CLI account mismatch.** This machine's `stripe`
  CLI is already authenticated — but to an account called "Vitale health
  sandbox" (`acct_1Thxjz3rFpMM3SH9`), which is almost certainly unrelated
  to Metis. Found via `stripe config --list` while writing TESTING.md; I
  did not run any triggers or create any test data against it. Run
  `stripe login` to point it at Metis's actual account before following
  TESTING.md.

## Database (Supabase)

- [ ] **Run the Phase 1 schema migration** in the Supabase SQL editor before
  testing anything Stripe-related end to end — see the SQL block added to
  `supabase/schema.sql` under "Stripe / billing (Phase 1)". Nothing in the
  webhook can persist state until this runs; every write will fail against the
  live database until it does.
- [ ] **Run the Phase 2 duration/cost migration too** — the block under
  "Run duration / cost logging (Phase 2 task 2.3)" in the same file. Confirmed
  via `npm run duration-stats` that `research_runs.duration_ms` doesn't exist
  in production yet.

- [ ] **Run the pro_grace_expires_at migration too** — same file, under
  "Legacy-account Pro grace period." Needed before `grant-legacy-pro-grace.mjs`
  can run at all (it also depends on the Phase 1 `stripe_customer_id` column).

- [ ] **Run the report_issues migration too** (task 3.4) — same file, under
  "Report issue reports." Needed before the "Something wrong in this report?"
  form can save anything; it'll 500 until this runs.

- [ ] **Run the transactional-email migration too** (task 4.2) — same file,
  under "Transactional email." Just two columns on `profiles`
  (`day7_email_sent_at`, `last_cap_reached_email_at`) — needed before the
  day-7 job or the cap-reached email can de-duplicate correctly.

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
- [ ] **Verify a sending domain and set `EMAIL_FROM`** (e.g.
  `"Metis <hello@metisanalytic.com>"`). Without a verified domain, Resend's
  default `onboarding@resend.dev` only delivers to your own Resend account
  email — fine for testing the wiring, not for real users.
- [ ] **Replace the placeholder name in `src/lib/email/copy.ts`.** Every
  email is signed `— Nick` right now — a placeholder, not a real person on
  this team as far as I know from the repo. That file is the single place
  to edit all three emails' copy (subject + body); nothing else needs to
  change to update wording.
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
- [ ] **DB backups** — confirm Supabase project backup settings (Settings →
  Database → Backups). Not visible from the repo; see Phase 4.5 for a local
  restore-test script once this is confirmed configured.
- [ ] **Legal review flag** — `LEGAL_PAGES_FINAL` (Phase 2.5) stays `false`
  until an attorney has actually reviewed Terms/Privacy. Flipping it is a
  business decision, not a code change.

*(This file grows as later phases surface more human-only tasks.)*
