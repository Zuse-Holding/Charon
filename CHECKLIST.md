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
- [ ] **Untrack `.env.local`** — flagged in `AUDIT.md`: a real (likely expired)
  Vercel OIDC token is currently committed and tracked in this public repo.
  `git rm --cached .env.local` (already gitignored, just never actually removed
  from the index).

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
