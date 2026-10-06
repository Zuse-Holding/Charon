"""
SELENE OS — approved-action executor (spec §7 step 10)
The step between "Nick tapped Approve" and the thing actually happening.
Plain code, no model anywhere in this file, and nothing here is reachable as
an agent tool: the `claude` CLI only ever spawns agents/mcp_tools.py, which
doesn't import this module (tests/test_executor.py asserts it).

    python -m agents.executor        # cron, every 2 minutes

Rules:
  - Only rows with status='approved' whose resolved_at is older than
    SETTLE_SECONDS. The dashboard's undo window is 10s; waiting longer means
    an undo always wins the race.
  - Claim before acting: flip approved -> executing with a conditional
    update. Two overlapping executors can't both claim a row, and a crash
    mid-send leaves the row 'executing' rather than retrying. At most once
    beats at least once when the action is an email.
  - Payloads are validated here, not trusted from the model. contact_lead
    always mails the address on the lead row, never one from the payload.
"""

from __future__ import annotations

import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from supabase import create_client

from agents import gmail_send, stripe_api

SUPABASE = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

SETTLE_SECONDS = 20
BATCH = 20
MAX_RECIPIENTS = 5

EMAIL_RE = re.compile(r"^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$")
VENTURES = {"zuse", "metis", "charon", "lounge", "kairos", "personal_mixed"}  # "trading" retired
LEAD_STATUSES = {"new", "enriched", "contacted", "replied", "qualified", "closed", "dead"}
METIS_PRODUCTS = {"intelligence", "diligence", "committee"}
INVOICE_MAX_ITEMS = 20
INVOICE_MAX_TOTAL = 250_000  # dollars; anything bigger gets done by hand in Stripe


class InvalidPayload(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _str(payload: dict[str, Any], key: str, max_len: int, required: bool = True) -> str | None:
    val = payload.get(key)
    if val is None or val == "":
        if required:
            raise InvalidPayload(f"missing {key}")
        return None
    if not isinstance(val, str):
        raise InvalidPayload(f"{key} must be text")
    if len(val) > max_len:
        raise InvalidPayload(f"{key} is longer than {max_len} characters")
    return val


def _recipients(raw: Any) -> list[str]:
    addrs = [raw] if isinstance(raw, str) else raw
    if not isinstance(addrs, list) or not addrs:
        raise InvalidPayload("missing to")
    addrs = [a.strip() for a in addrs if isinstance(a, str)]
    if len(addrs) > MAX_RECIPIENTS:
        raise InvalidPayload(f"more than {MAX_RECIPIENTS} recipients")
    bad = [a for a in addrs if not EMAIL_RE.match(a)]
    if bad or not addrs:
        raise InvalidPayload(f"not an email address: {', '.join(bad) or raw!r}")
    return addrs


def _email_fields(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "subject": _str(payload, "subject", 300),
        "body": _str(payload, "body", 20_000),
        "thread_id": _str(payload, "thread_id", 200, required=False),
        "in_reply_to": _str(payload, "in_reply_to", 1000, required=False),
        "references": _str(payload, "references", 4000, required=False),
    }


def _lead(row: dict[str, Any]) -> dict[str, Any]:
    if not row.get("related_lead"):
        raise InvalidPayload("no related_lead on this item")
    found = SUPABASE.table("leads").select("*").eq("id", row["related_lead"]).execute().data
    if not found:
        raise InvalidPayload("the lead this points at no longer exists")
    return found[0]


# ============================================================
# HANDLERS — one per IRREVERSIBLE_ACTIONS entry (agents/constants.py)
# ============================================================


def do_send_email(row: dict[str, Any]) -> str:
    payload = row["payload"]
    to = _recipients(payload.get("to"))
    sent_id = gmail_send.send(to=to, **_email_fields(payload))
    if row.get("related_triage"):
        SUPABASE.table("inbox_triage").update({"needs_reply": False}).eq("id", row["related_triage"]).execute()
    return f"sent to {', '.join(to)} (gmail id {sent_id})"


def do_contact_lead(row: dict[str, Any]) -> str:
    lead = _lead(row)
    if not lead.get("email") or not EMAIL_RE.match(lead["email"]):
        raise InvalidPayload("lead has no usable email address")
    sent_id = gmail_send.send(to=[lead["email"]], **_email_fields(row["payload"]))
    now = _now().isoformat()
    SUPABASE.table("leads").update({"status": "contacted", "last_touch_at": now}).eq("id", lead["id"]).execute()
    SUPABASE.table("lead_events").insert({
        "lead_id": lead["id"], "event_type": "contacted", "detail": f"first touch sent (gmail id {sent_id})",
    }).execute()
    return f"sent to {lead['email']} (gmail id {sent_id})"


def do_update_lead_status(row: dict[str, Any]) -> str:
    lead = _lead(row)
    status = row["payload"].get("status")
    if status not in LEAD_STATUSES:
        raise InvalidPayload(f"unknown lead status {status!r}")
    SUPABASE.table("leads").update({"status": status}).eq("id", lead["id"]).execute()
    SUPABASE.table("lead_events").insert({
        "lead_id": lead["id"], "event_type": "status_change", "detail": f"{lead['status']} -> {status}",
    }).execute()
    return f"lead moved to {status}"


def do_add_ledger_entry(row: dict[str, Any]) -> str:
    p = row["payload"]
    try:
        amount = round(float(p.get("amount")), 2)
    except (TypeError, ValueError) as e:
        raise InvalidPayload("amount must be a number") from e
    if amount <= 0 or amount > 1_000_000:
        raise InvalidPayload("amount out of range")
    direction = p.get("direction", "out")
    if direction not in ("in", "out"):
        raise InvalidPayload("direction must be in or out")
    venture = p.get("venture", "zuse")
    if venture not in VENTURES:
        raise InvalidPayload(f"unknown venture {venture!r}")
    entry_date = p.get("entry_date") or date.today().isoformat()
    try:
        date.fromisoformat(entry_date)
    except (TypeError, ValueError) as e:
        raise InvalidPayload("entry_date must be YYYY-MM-DD") from e
    pct = p.get("business_use_pct", 100)
    if not isinstance(pct, int) or not 0 <= pct <= 100:
        raise InvalidPayload("business_use_pct must be a whole number 0-100")
    deductible = p.get("deductible", True)
    if not isinstance(deductible, bool):
        raise InvalidPayload("deductible must be true or false")

    vendor = _str(p, "vendor", 200)
    SUPABASE.table("ledger").insert({
        "entry_date": entry_date,
        "vendor": vendor,
        "description": _str(p, "description", 500, required=False),
        "amount": amount,
        "direction": direction,
        "category": _str(p, "category", 60),
        "venture": venture,
        "deductible": deductible,
        "business_use_pct": pct,
        "receipt_url": _str(p, "receipt_url", 1000, required=False),
        "source": "email_forward" if row["module"] == "finance" else "agent",
    }).execute()
    return f"logged {vendor} ${amount:.2f}"


def _invoice_items(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise InvalidPayload("an invoice needs at least one line item")
    if len(raw) > INVOICE_MAX_ITEMS:
        raise InvalidPayload(f"more than {INVOICE_MAX_ITEMS} line items")
    items = []
    for i, it in enumerate(raw, 1):
        if not isinstance(it, dict):
            raise InvalidPayload(f"line {i} isn't an item")
        desc = _str(it, "description", 300)
        try:
            cents = round(float(it.get("amount")) * 100)
        except (TypeError, ValueError) as e:
            raise InvalidPayload(f"line {i}: amount must be a number") from e
        qty = it.get("quantity", 1)
        if not isinstance(qty, int) or isinstance(qty, bool) or not 1 <= qty <= 1000:
            raise InvalidPayload(f"line {i}: quantity must be a whole number 1-1000")
        if cents <= 0:
            raise InvalidPayload(f"line {i}: amount must be more than zero")
        items.append({"description": desc, "unit_cents": cents, "quantity": qty})
    total = sum(it["unit_cents"] * it["quantity"] for it in items) / 100
    if total > INVOICE_MAX_TOTAL:
        raise InvalidPayload(f"total ${total:,.2f} is over the ${INVOICE_MAX_TOTAL:,} limit")
    return items


def _metis_product_id(key: str, product: str) -> str:
    """The Stripe product tagged metadata.metis_product=<product>. Lines are
    priced against it so revenue lands under the right Metis product."""
    found = stripe_api.request(
        "GET", "/products/search", key, {"query": f"metadata['metis_product']:'{product}'", "limit": 1},
    ).get("data", [])
    if not found:
        raise InvalidPayload(
            f"no Stripe product tagged metis_product={product}. Add that metadata to the product in Stripe."
        )
    return found[0]["id"]


def do_send_invoice(row: dict[str, Any]) -> str:
    """Create, finalize and send a Stripe invoice. Every Stripe write carries
    an idempotency key derived from the approval row, so even a manual
    re-run of the same row can't double-bill."""
    p = row["payload"]
    product = p.get("product")
    if product not in METIS_PRODUCTS:
        raise InvalidPayload(f"product must be one of {', '.join(sorted(METIS_PRODUCTS))}")
    items = _invoice_items(p.get("items"))
    days = p.get("days_until_due", 30)
    if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 90:
        raise InvalidPayload("days_until_due must be a whole number 1-90")
    memo = _str(p, "memo", 500, required=False)

    # A lead-linked invoice always bills the address on the lead.
    lead = _lead(row) if row.get("related_lead") else None
    email = (lead or {}).get("email") or p.get("customer_email")
    if not isinstance(email, str) or not EMAIL_RE.match(email):
        raise InvalidPayload("no usable customer email")
    name = _str(p, "customer_name", 200, required=False) or (lead or {}).get("name")

    key = stripe_api.key_from_env("STRIPE_INVOICE_KEY")
    idem = f"selene-{row['id']}"
    product_id = _metis_product_id(key, product)

    existing = stripe_api.request("GET", "/customers", key, {"email": email, "limit": 1}).get("data", [])
    customer = existing[0]["id"] if existing else stripe_api.request(
        "POST", "/customers", key, {"email": email, "name": name, "metadata": {"source": "selene"}},
        idempotency_key=f"{idem}-customer",
    )["id"]

    invoice = stripe_api.request("POST", "/invoices", key, {
        "customer": customer,
        "collection_method": "send_invoice",
        "days_until_due": days,
        "auto_advance": False,
        "pending_invoice_items_behavior": "exclude",
        "description": memo,
        "metadata": {"approval_id": row["id"], "metis_product": product},
    }, idempotency_key=f"{idem}-invoice")
    try:
        for n, it in enumerate(items):
            stripe_api.request("POST", "/invoiceitems", key, {
                "customer": customer,
                "invoice": invoice["id"],
                "description": it["description"],
                "quantity": it["quantity"],
                "price_data": {"currency": "usd", "product": product_id, "unit_amount": it["unit_cents"]},
            }, idempotency_key=f"{idem}-item-{n}")
        stripe_api.request("POST", f"/invoices/{invoice['id']}/finalize", key, idempotency_key=f"{idem}-finalize")
        sent = stripe_api.request("POST", f"/invoices/{invoice['id']}/send", key, idempotency_key=f"{idem}-send")
    except Exception as e:  # noqa: BLE001 — say exactly where it stopped
        raise RuntimeError(f"{e} — Stripe draft {invoice['id']} was created but not sent. Check it in Stripe.") from e

    due = sent.get("due_date")
    amount = sent.get("amount_due", 0) / 100
    SUPABASE.table("invoices").insert({
        "approval_id": row["id"],
        "stripe_invoice_id": sent["id"],
        "number": sent.get("number"),
        "customer_email": email,
        "customer_name": name,
        "product": product,
        "lead_id": (lead or {}).get("id"),
        "amount_due": amount,
        "currency": sent.get("currency", "usd"),
        "status": "open",
        "due_date": datetime.fromtimestamp(due, tz=timezone.utc).date().isoformat() if due else None,
        "hosted_url": sent.get("hosted_invoice_url"),
        "synced_at": _now().isoformat(),
    }).execute()
    label = sent.get("number") or sent["id"]
    if lead:
        SUPABASE.table("lead_events").insert({
            "lead_id": lead["id"], "event_type": "invoiced", "detail": f"invoice {label} sent",
        }).execute()
    return f"invoice {label} sent to {email} for ${amount:,.2f}"


HANDLERS: dict[str, Callable[[dict[str, Any]], str]] = {
    "send_email": do_send_email,
    "contact_lead": do_contact_lead,
    "update_lead_status": do_update_lead_status,
    "add_ledger_entry": do_add_ledger_entry,
    "send_invoice": do_send_invoice,
}


# ============================================================
# LOOP
# ============================================================


def _claim(row_id: str) -> bool:
    """approved -> executing, only if it's still approved. False means an
    undo or another executor got there first."""
    res = (
        SUPABASE.table("approval_queue").update({"status": "executing"})
        .eq("id", row_id).eq("status", "approved").execute()
    )
    return bool(res.data)


def execute_one(row: dict[str, Any]) -> str | None:
    """Returns 'executed' / 'failed', or None if the row wasn't ours to run."""
    if not _claim(row["id"]):
        return None
    handler = HANDLERS.get(row["action_type"])
    try:
        if handler is None:
            raise InvalidPayload(f"no executor for action_type {row['action_type']!r}")
        detail = handler(row)
    except Exception as e:  # noqa: BLE001 — every failure lands on the row, loudly
        SUPABASE.table("approval_queue").update({
            "status": "failed", "error": str(e)[:500], "executed_at": _now().isoformat(),
        }).eq("id", row["id"]).execute()
        return "failed"
    SUPABASE.table("approval_queue").update({
        "status": "executed", "executed_at": _now().isoformat(), "error": None, "result": detail,
    }).eq("id", row["id"]).execute()
    return "executed"


def run_executor() -> dict[str, int]:
    cutoff = (_now() - timedelta(seconds=SETTLE_SECONDS)).isoformat()
    rows = (
        SUPABASE.table("approval_queue").select("*")
        .eq("status", "approved").lte("resolved_at", cutoff)
        .order("resolved_at").limit(BATCH).execute().data
    )
    tally = {"executed": 0, "failed": 0}
    for row in rows:
        outcome = execute_one(row)
        if outcome:
            tally[outcome] += 1
    if rows:
        SUPABASE.table("agent_runs").insert({
            "job": "executor",
            "status": "failed" if tally["failed"] else "ok",
            "finished_at": _now().isoformat(),
            "actions_proposed": 0,
            "log": f"{tally['executed']} done, {tally['failed']} failed",
        }).execute()
    return tally


if __name__ == "__main__":
    result = run_executor()
    print(f"executor: {result['executed']} done, {result['failed']} failed")
    sys.exit(1 if result["failed"] else 0)
