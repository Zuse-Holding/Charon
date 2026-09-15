# Stripe Integration — Prep

Status: **scaffolding done, not wired to real keys, not deployed.** Code in this doc's
companion files runs but every route 500s until real Stripe keys/price IDs are set —
that's intentional, so this can sit in the repo safely until tonight's session.

## Where things stand today

There is no billing system at all (confirmed in [team-features-scoping.md](team-features-scoping.md)
and in the marketing-copy cleanup pass — see git history). `profiles.tier` is a plain text
column, set by hand today (Supabase dashboard, or the `ADMIN_USER_IDS`/`POLITICAL_ACCESS_USER_IDS`
allowlists in `server/agent-server.ts`). `getUserTier()` in `server/agent-server.ts:147`
defaults anyone with no `tier` value to `"basic"` — meaning **every signup today silently
gets Basic-tier access for free**, forever, with nothing to stop them.

The good news: every tier-gated route already reads from one place —
`profiles.tier` — via `getUserTier()`. That function doesn't change. Stripe's whole job
is to keep that one column truthful. This is not a rebuild of the gating logic, just
wiring a real source of truth into the column it already trusts.

## Chosen approach: Stripe Checkout (hosted), not Stripe Elements

Stripe Checkout redirects the customer to a Stripe-hosted payment page and redirects
back on success/cancel. We never see or touch card data — Stripe is PCI-compliant on
our behalf. This also matches the constraint that nobody (human or agent) should be
handling raw card numbers. Elements (embedded card form) would put us in PCI scope for
no real benefit here — skip it.

## What's scaffolded (this session)

- `stripe` npm package installed in `web/` (`web/package.json`)
- `.env.example` updated with the 5 new variables (all blank — see below)
- Three new API routes, following this repo's existing `web/app/api/*` conventions
  (`createServerSupabaseClient()` for the logged-in user, `createServiceClient()` for
  admin writes — see `web/lib/supabase/server.ts`):

  | Route | Job |
  |---|---|
  | `POST /api/stripe/checkout` | Creates a Checkout Session for `{ plan: "basic" \| "pro" \| "team" }`, redirects the logged-in user to Stripe. `client_reference_id` = Supabase user id, so the webhook knows who to update. |
  | `POST /api/stripe/webhook` | Verifies the Stripe signature, handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Writes `profiles.tier` + the new `stripe_*` columns via the service-role client. |
  | `POST /api/stripe/portal` | Creates a Billing Portal session so a user can update payment method or cancel themselves — this is what actually makes the pricing page's existing "cancel anytime" FAQ answer true. |

All three currently throw a clear 500 ("Stripe is not configured") if `STRIPE_SECRET_KEY`
is unset, rather than silently no-op-ing — so a misconfiguration is loud, not a quiet
Basic-tier fallback.

## What's NOT done yet (tonight's actual work)

1. **Create the Stripe account / products** — can't do this part for you, it's your
   Stripe dashboard. In test mode first:
   - One Product per plan: **Basic** ($19/mo), **Pro** ($49/mo), **Team** ($149/mo) —
     each with one recurring monthly Price. Enterprise stays `mailto:` (custom/sales,
     not self-serve) — don't make a Stripe Price for it.
   - Copy the three `price_...` IDs into `.env.local` as `STRIPE_PRICE_ID_BASIC/PRO/TEAM`.
   - Developers → API keys → copy the **test** secret key into `STRIPE_SECRET_KEY`.
   - Developers → Webhooks → add an endpoint. For local testing, use the Stripe CLI
     instead of a dashboard endpoint: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
     — it prints a `whsec_...` value, put that in `STRIPE_WEBHOOK_SECRET`.
2. **Apply the schema change below** to Supabase (SQL editor or CLI) — not done
   automatically, since it's a live production database and should be a deliberate step,
   not something that happens as a side effect of a prep session.
3. **Wire the pricing page CTAs.** `web/app/pricing/page.tsx` and `web/app/page.tsx`
   currently send every plan button to `/login?mode=signup` with no memory of which
   plan was clicked. Needs: carry the choice through signup (e.g. `?plan=pro`), then
   call `/api/stripe/checkout` right after — this is a real UX call (checkout before
   vs. after account creation), so it's left as a decision for tonight, not guessed at
   here.
4. **Settings page** — swap the "Contact us to upgrade" mailto link
   (`web/app/settings/page.tsx:358`) for a real upgrade button once checkout works, and
   add a "Manage billing" button that calls `/api/stripe/portal`.
5. **Test the full loop**: signup → checkout → webhook fires → `profiles.tier` flips →
   gated features unlock, using Stripe's test card `4242 4242 4242 4242`, any future
   expiry, any CVC.
6. **Go live**: swap test keys for live keys, add the real webhook endpoint in the
   Stripe dashboard (`https://metisanalytic.com/api/stripe/webhook`), remove the CLI
   forwarding.

## Schema change needed (proposed — not applied to Supabase yet)

Same incremental-`ALTER TABLE` pattern already used in `supabase/schema.sql` for
`display_name`/`notification_preferences`. Run this in the Supabase SQL editor when
ready — safe to run more than once (`IF NOT EXISTS` throughout):

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT; -- active | past_due | canceled | incomplete | trialing
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Webhook writes are keyed off stripe_customer_id, so lookups by it need
-- to be fast (checkout.session.completed only gives us the customer id
-- on later subscription-update events, not the Supabase user id again).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON profiles (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
```

## Known gap: Team seat billing (+$40/seat)

The pricing page already advertises "3 seats included (+$40/seat after)" for Team, but
per `team-features-scoping.md`, **the multi-seat workspace feature doesn't exist yet** —
Team tier today is single-user, same as Pro with higher limits. There's nothing to
attach per-seat billing to.

Recommendation for tonight: bill Team as a **flat $149/mo price**, same as Basic/Pro.
Don't build Stripe quantity/seat metering until the workspace feature itself ships —
building seat billing for a seat system that doesn't exist yet is the wrong order of
operations. Revisit this section once `workspaces`/`workspace_members` (see
`team-features-scoping.md`) actually land.

## Open questions for tonight

- **Trial tier collision.** `profiles.tier` already has a `"trial"` value (time-boxed
  demo/partner accounts, gated by `trial_expires_at`) that has nothing to do with
  Stripe. Make sure the webhook only ever writes `basic`/`pro`/`team`, never touches
  accounts sitting in `trial` or `internal` — a bad webhook write could accidentally
  demote a demo account or (worse) an internal/Charon account.
- **Downgrade/cancellation timing.** Stripe's `customer.subscription.deleted` fires at
  the end of the paid period, not the moment someone clicks cancel (if using
  `cancel_at_period_end`). Decide whether `profiles.tier` should drop to `basic`
  immediately on cancel-intent or only once the period actually ends — the Billing
  Portal defaults to the latter, which matches the existing pricing FAQ's "cancel
  anytime... every plan is month-to-month" language reasonably well.
- **Failed payments.** `customer.subscription.updated` will also fire with
  `status: "past_due"`. Decide whether that should immediately downgrade access or
  grace-period it — Stripe's own dunning emails handle retries, this is just about
  what `profiles.tier` should say in the meantime.
