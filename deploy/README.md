# Turning Selene on

Do these steps in order. Steps 1–2 happen in Supabase and Vercel. Steps 3–7 happen on the agent box: the Pi, or any Linux machine that stays on.

## 1. Supabase
In the SQL editor, run each of these once, in order:
- `supabase/selene_os_migrations/002_executor.sql` adds the executor states and the idempotency keys. It also removes the browser's ability to approve queue items, so do step 2 right after.
- `supabase/selene_os_migrations/003_contracts.sql` adds contracts, plus the trigger that puts their dates on the compliance clock. The compliance job needs this table, so don't skip it.
- `supabase/selene_os_migrations/004_invoices.sql` adds invoices, plus a key that stops a payment landing in the ledger twice.

## 2. Dashboard env (Vercel → Project → Settings → Environment Variables)
- `DASHBOARD_PASSWORD` is required. Every page, API route and JS bundle sits behind the login. If it isn't set, a production deploy lets nobody in.
- `STRIPE_RESTRICTED_KEY` is optional. It's a read-only restricted key for Metis revenue (see `dashboard/.env.local.example`).

Redeploy after adding them.

## 3. Repo + Python
```bash
git clone <repo> ~/selene-os && cd ~/selene-os
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp agents/.env.example .env    # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

## 4. Claude CLI
```bash
npm install -g @anthropic-ai/claude-code
claude login            # Pro/Max subscription; leave it logged in
```

## 5. Gmail
1. In Google Cloud, create a project, enable the Gmail API, and create an OAuth client of type **Desktop app**.
2. Put its client ID and secret in `.env`.
3. Run each command below once. Each prints a token to paste into `.env`.

```bash
set -a; . ./.env; set +a
.venv/bin/python -m agents.gmail_auth read   # → GMAIL_READ_REFRESH_TOKEN
.venv/bin/python -m agents.gmail_auth send   # → GMAIL_SEND_REFRESH_TOKEN
```
For receipts, make a Gmail filter that labels forwarded receipts `ledger`. The finance job reads that label.

## 5b. Stripe (for invoices)
1. In Stripe → Products, add metadata `metis_product` to each product: `intelligence`, `diligence` or `committee`. Invoices are priced against these, so revenue lands under the right product.
2. Under Developers → API keys, create two **restricted** keys and put them in `.env`. A full `sk_` key is refused.
   - `STRIPE_INVOICE_KEY`: Write on Customers, Invoices and Invoice items; Read on Products.
   - `STRIPE_RESTRICTED_KEY`: Read on Invoices, Subscriptions, Charges and Products. The same key works for the dashboard's revenue view.

Invoices you draft (or that Selene proposes) wait in the approval queue. Approving one creates it in Stripe, and Stripe emails the customer a payment link. Every 15 minutes, a sync job marks paid invoices, logs the payment to the ledger once, and closes the linked lead.

## 6. Dry run, one job at a time
```bash
chmod +x deploy/run-job.sh
deploy/run-job.sh compliance && tail logs/compliance.log
deploy/run-job.sh inbox      && tail logs/inbox.log
```
Each run shows up in the dashboard's live feed. Drafts land in the queue.

## 7. Schedule
Edit the path in `deploy/crontab`, then run:
```bash
sudo timedatectl set-timezone America/Los_Angeles
crontab deploy/crontab
```

## What happens after you approve
The executor runs every 2 minutes. It picks up an approval once it's at least 20 seconds old, which is after the 10-second undo window has closed.

It carries the action out exactly once:
- If something fails, the row turns red under "Recently handled" with the reason.
- It never retries on its own. If an item ever sits at "Going out now", check Gmail's Sent folder before doing anything else.
