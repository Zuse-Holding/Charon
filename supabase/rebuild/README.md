# Rebuilding Intelligence's Supabase project

Only for the case where Supabase **can't restore** the deleted project
(`tlchqqvspnhfoxcisjrv`, "Selene Intel", deleted around 7:00 PM PT on Oct 18, 2026).
If they restore it with the same ref, the URL and keys are unchanged and none of
this is needed.

Tested on Oct 18 against a local Postgres 17 with stand-ins for Supabase's
`auth` and `storage` schemas: every file ran without errors and was safe to run
again. Afterwards, all 20 tables the code uses existed, every `profiles` column
the code reads was present, the signup trigger created a profile, and a signed-in
user could not change their own tier.

## 1. Create the project

New project in Supabase (any name, e.g. `metis-intelligence`), in the region
closest to the Vercel deployment. Save the database password somewhere safe.

## 2. Create the tables

In the SQL Editor, run these files in this order. Each one can be re-run
safely if a paste fails partway.

1. `supabase/rebuild/00_missing_base_tables.sql`: `profiles`,
   `person_search_audit`, `pinned_feed_items` (they were made by hand in the old
   dashboard and never written down).
2. `supabase/schema.sql`: everything else, plus the signup trigger, the
   `kg_decide_match` function, and the private `snapshots` storage bucket.
3. `supabase/statewide_executives_seed.sql`
4. `supabase/statewide_executives_seed_2.sql` (240 rows in total after both).

## 3. Auth settings

- **Site URL:** `https://www.metisanalytic.com`
- **Redirect URLs:** `https://www.metisanalytic.com/auth/callback`,
  `https://metisanalytic.com/auth/callback`, `http://localhost:3000/auth/callback`
- **Google provider:** turn it on with the same Google OAuth client ID and
  secret as before. In Google Cloud Console, add
  `https://<new-ref>.supabase.co/auth/v1/callback` to that client's authorized
  redirect URIs.
- **Email:** set "Confirm email", the custom SMTP sender (if one was used) and the
  email templates to match what the old project had. These weren't saved
  anywhere in the repo.

## 4. Point the apps at it

From Project Settings, then API, copy the project URL, the anon (publishable)
key and the service-role (secret) key.

| Where | Variable | Value |
| --- | --- | --- |
| Vercel `charon_v1` (Production and Preview) | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
| | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| | `SUPABASE_SERVICE_ROLE_KEY` | service-role key |
| Railway agent server | `SUPABASE_URL` | project URL |
| | `SUPABASE_SERVICE_ROLE_KEY` | service-role key |
| | `SUPABASE_SECRET_KEY` (only if it's set there) | service-role key |
| Local `.env` / `web/.env.local` | same names | same values |

Then redeploy `charon_v1` on Vercel and restart the Railway service. A new
environment value only takes effect after a redeploy.

## 5. Check it works

On www.metisanalytic.com: sign up with email, sign in with Google, run a quick
report, add something to the watchlist, and pin a feed item.

## 6. Paying customers

Stripe still has every customer and subscription, but the new project doesn't
know which account is theirs, so they'd show as Free.

1. Ask each subscriber to sign up again **with the same email** they pay with.
   Their emails are in the Stripe dashboard under Customers.
2. Preview the links (changes nothing):
   `cd web && npx tsx --env-file=.env.local scripts/relink-stripe-customers.ts`
3. Write them:
   `cd web && npx tsx --env-file=.env.local scripts/relink-stripe-customers.ts --apply`
4. Run it again whenever more subscribers have signed up again. It lists who
   is still missing.

Until someone is relinked, Stripe webhook events for them log "no profile found
for stripe_customer_id" and are skipped. That's harmless; the relink catches
them up.

## What can't be rebuilt

User accounts (everyone signs up again), saved reports and deep dives,
watchlists, knowledge-graph entities, pins, usage history and the stored source
snapshots. Legacy Pro grace grants (`grant-legacy-pro-grace.mjs`) would need
re-granting.
