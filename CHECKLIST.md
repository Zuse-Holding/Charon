# Human tasks deferred during Phase 1–4

Things I found that need a decision, a dashboard click, or access I don't have —
tracked here as they come up rather than left buried in commit messages.

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
