"""
SELENE OS — invoice status sync
Pure code, no model. Pulls each open invoice's status from Stripe with the
read-only key and, the first time one shows as paid:
  - logs the payment to the ledger (direction 'in'), keyed on
    source_ref='stripe:<invoice id>' so it can only land once
  - moves a linked lead to 'closed'

    python -m agents.invoices        # cron, every 15 minutes

Writes an agent_runs row only when something changed or failed, so a
quiet hour doesn't fill the feed.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from typing import Any

from supabase import create_client

from agents import stripe_api

SUPABASE = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# Stripe status -> ours. 'draft' never reaches the table (the executor only
# records sent invoices); anything unexpected leaves the row as it was.
STATUS_MAP = {"open": "open", "paid": "paid", "void": "void", "uncollectible": "uncollectible"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_payment(inv: dict[str, Any], stripe_inv: dict[str, Any]) -> None:
    paid_ts = (stripe_inv.get("status_transitions") or {}).get("paid_at")
    paid_day = datetime.fromtimestamp(paid_ts, tz=timezone.utc).date() if paid_ts else datetime.now(timezone.utc).date()
    SUPABASE.table("ledger").upsert({
        "entry_date": paid_day.isoformat(),
        "vendor": inv.get("customer_name") or inv["customer_email"],
        "description": f"Invoice {inv.get('number') or inv['stripe_invoice_id']} paid"
                       + (f" · Metis {inv['product'].title()}" if inv.get("product") else ""),
        "amount": stripe_inv.get("amount_paid", 0) / 100,
        "direction": "in",
        "category": "revenue",
        "venture": "metis",
        "deductible": False,
        "business_use_pct": 100,
        "source": "stripe",
        "source_ref": f"stripe:{inv['stripe_invoice_id']}",
    }, on_conflict="source_ref", ignore_duplicates=True).execute()

    if inv.get("lead_id"):
        lead = SUPABASE.table("leads").select("id, status").eq("id", inv["lead_id"]).execute().data
        if lead and lead[0]["status"] != "closed":
            SUPABASE.table("leads").update({"status": "closed", "last_touch_at": _now()}).eq("id", inv["lead_id"]).execute()
            SUPABASE.table("lead_events").insert({
                "lead_id": inv["lead_id"], "event_type": "status_change",
                "detail": f"{lead[0]['status']} -> closed (invoice paid)",
            }).execute()


def sync() -> dict[str, int]:
    key = stripe_api.key_from_env("STRIPE_RESTRICTED_KEY")
    tally = {"checked": 0, "paid": 0, "changed": 0, "failed": 0}
    errors: list[str] = []
    for inv in SUPABASE.table("invoices").select("*").eq("status", "open").execute().data:
        tally["checked"] += 1
        try:
            s = stripe_api.request("GET", f"/invoices/{inv['stripe_invoice_id']}", key)
        except Exception as e:  # noqa: BLE001 — one bad invoice shouldn't stop the rest
            tally["failed"] += 1
            errors.append(f"{inv['stripe_invoice_id']}: {e}")
            continue
        status = STATUS_MAP.get(s.get("status"), inv["status"])
        update: dict[str, Any] = {"synced_at": _now(), "amount_paid": s.get("amount_paid", 0) / 100}
        if status != inv["status"]:
            update["status"] = status
            tally["changed"] += 1
        if status == "paid":
            paid_ts = (s.get("status_transitions") or {}).get("paid_at")
            update["paid_at"] = datetime.fromtimestamp(paid_ts, tz=timezone.utc).isoformat() if paid_ts else _now()
            _record_payment(inv, s)
            tally["paid"] += 1
        SUPABASE.table("invoices").update(update).eq("id", inv["id"]).execute()

    if tally["changed"] or tally["failed"]:
        SUPABASE.table("agent_runs").insert({
            "job": "invoices",
            "status": "failed" if tally["failed"] else "ok",
            "finished_at": _now(),
            "actions_proposed": 0,
            "log": f"{tally['paid']} paid, {tally['changed']} changed"
                   + (f"; {tally['failed']} failed — {'; '.join(errors)[:400]}" if errors else ""),
        }).execute()
    return tally


if __name__ == "__main__":
    t = sync()
    print(f"invoices: {t['checked']} checked, {t['paid']} paid, {t['failed']} failed")
    sys.exit(1 if t["failed"] else 0)
