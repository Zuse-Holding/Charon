# Phase 1 (Billing) — Manual Test Script

## ⚠️ Before you start: whose Stripe account is this?

The Stripe CLI on this machine is already installed and authenticated — but
to an account called **"Vitale health sandbox"** (`acct_1Thxjz3rFpMM3SH9`),
not whatever Metis's own Stripe account is. I found this while checking for
the CLI (`stripe config --list`) and did **not** run anything against it —
using a different project's sandbox to generate Metis test events would be
the wrong account's data, not a real test.

Before running anything below: `stripe login` to switch to Metis's actual
Stripe account (test mode), or confirm deliberately that "Vitale health
sandbox" is actually meant to double as Metis's dev Stripe account. Don't
skip this — every command below assumes you're pointed at the right account.

## What I verified locally (no real Stripe account needed)

- `npm run typecheck` (root) and `npx tsc --noEmit` (web/) — clean after
  every commit in this phase.
- Dev server boots; `/api/stripe/checkout`, `/api/stripe/webhook`,
  `/api/stripe/portal` all respond with a clear configured-error message
  (not a crash) when `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are unset —
  confirmed via curl against a local dev server.
- Found and fixed a real bug via browser testing: `middleware.ts` was
  redirecting unauthenticated `/api/*` calls to `/login`, and `fetch()`
  silently followed that redirect — so the pricing page's "not logged in"
  branch never fired. Now fixed (`redirect: "manual"` in
  `web/lib/checkout.ts`) and reverified: clicking Basic/Pro while logged
  out correctly lands on `/login?mode=signup&plan=basic|pro`.
- Confirmed neither `research_runs`/`profiles.stripe_customer_id` etc. nor
  `stripe_webhook_events` exist in the live database yet (grepped
  `supabase/schema.sql` — the migration is written but the SQL Editor step
  hasn't been run). **Nothing below will work end-to-end until that
  migration runs — see CHECKLIST.md.**

## What I could NOT verify locally (needs real keys + the schema migration)

- An actual Checkout Session being created and completed
- The webhook actually receiving, verifying, and processing a real event
- Idempotency (a duplicate event actually being skipped)
- The full cancel → period-end → downgrade lifecycle
- The full failed-payment → past_due banner → downgrade lifecycle
- Promo code redemption
- Entitlement enforcement against real usage rows (the logic mirrors the
  existing, already-working Basic 25/month check exactly, but hasn't been
  exercised against a real database with the new columns)

## Setup (once, before any scenario below)

1. `stripe login` — confirm this is Metis's account, not another project's.
2. In the Stripe Dashboard (test mode): create **Basic** ($19/mo) and
   **Pro** ($49/mo) products, one recurring Price each. Copy both
   `price_...` ids into `.env.local` (both root and `web/`, or wherever
   your local env is actually loaded from) as `STRIPE_PRICE_BASIC_MONTHLY`
   / `STRIPE_PRICE_PRO_MONTHLY`. Set `STRIPE_SECRET_KEY` to the test secret
   key.
3. Run the Phase 1 schema migration in the Supabase SQL Editor — the block
   in `supabase/schema.sql` under "Stripe / billing (Phase 1)".
4. In one terminal: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   — copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.
5. In another terminal: `npm run dev` inside `web/`.
6. (Optional, for the coupon test) In the Dashboard: create a promotion
   code — 50 max redemptions, Pro at $29/mo forever (task 1.5's
   founding-member coupon — this is a Dashboard task, the app just enables
   `allow_promotion_codes`).

Test card numbers (any future expiry, any CVC, any ZIP):
- `4242 4242 4242 4242` — succeeds
- `4000 0000 0000 0341` — attaches but fails on the first charge
  (use this one for the failed-payment scenario)

## Scenario 1 — Successful checkout → plan appears → limits change

1. Sign up for a brand-new account (or use one currently on Free).
2. Confirm Free-tier limits first: Settings should show Free; try adding
   a 2nd watchlist entry — should 403 with "Watchlist limit of 1 reached."
   Run research 3 times — the 4th should 403 with the lifetime-cap message
   (not "resets" — it never does on Free).
3. Go to `/pricing`, click "Start Basic". Should redirect straight to
   Stripe Checkout (already logged in).
4. Pay with `4242 4242 4242 4242`.
5. Confirm: redirected to `/settings?checkout=success`. `stripe listen`'s
   terminal shows `checkout.session.completed` fired and a 200 response.
6. Refresh Settings — tier should now show **Basic**. Watchlist limit
   should now allow up to 5. PDF export option should now appear (Basic
   has it now, per task 1.6).
7. Try research again — Basic's 25/month cap should apply instead of the
   Free lifetime cap.

## Scenario 2 — Cancel → access continues until period end → downgrades

1. From Settings, click "Manage billing →" → opens the Stripe Customer
   Portal.
2. Cancel the subscription. **Verify the Portal actually says "at the end
   of the billing period," not "immediately"** — this is the Dashboard
   Portal configuration from CHECKLIST.md; if it says immediately, that
   config wasn't set correctly.
3. Confirm access is unchanged right after canceling (still Basic/Pro
   until the period actually ends) — `subscription.cancel_at_period_end`
   should be `true` in the Stripe Dashboard, and `profiles.cancel_at_period_end`
   should match after the webhook fires.
4. To simulate the period actually ending without waiting a month:
   `stripe trigger customer.subscription.deleted` (fill in the
   subscription/customer when prompted, or use the Dashboard to advance a
   test clock if you're using one). Confirm `profiles.tier` flips to
   `free` and access is actually restricted afterward.

## Scenario 3 — Failed payment → past_due banner → downgrade

1. Start a fresh Checkout, this time paying with `4000 0000 0000 0341`.
2. The initial charge should fail — confirm `checkout.session.completed`
   still fires (session completes) but the subscription's first invoice
   fails, or that Checkout itself blocks completion depending on how
   Stripe's test-decline timing lines up for this card; either way, watch
   for `invoice.payment_failed` in the `stripe listen` terminal.
3. If a subscription was created and is now `past_due`: reload any page
   while logged in as that user — the yellow banner (`PastDueBanner`)
   should appear site-wide, linking to Settings → Billing.
4. `stripe trigger customer.subscription.updated` with status forced to
   `unpaid` (or let Smart Retries exhaust naturally in test mode, which
   takes longer) — confirm `profiles.tier` flips to `free` and the banner
   disappears (status is no longer `past_due`, it's now `canceled`/`unpaid`
   with tier already downgraded).

## Scenario 4 — Promo code applies

1. Start Checkout for Pro. On Stripe's Checkout page, look for "Add
   promotion code" (confirms `allow_promotion_codes: true` is working) and
   enter the founding-member code from setup step 6.
2. Confirm the price shown updates to $29/mo before paying.
3. Pay with the success test card, confirm the subscription in the
   Dashboard shows the discount applied and recurring (not one-time).

## Idempotency check (task 1.3)

`stripe trigger checkout.session.completed`, then immediately run the same
trigger again with the same event (or use the Dashboard to resend the same
webhook delivery). Confirm the second delivery gets `{"received": true,
"deduped": true}` and does **not** create a second row / re-run any side
effects — check `stripe_webhook_events` has exactly one row for that event id.
