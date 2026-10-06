"""
SELENE OS — invoice tests
  - send_invoice: validated, idempotency-keyed, priced against the tagged
    Metis product, recorded once; lead-linked invoices bill the lead
  - partial Stripe failures say which draft was left behind
  - full secret keys are refused
  - status sync logs each payment to the ledger exactly once
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from agents import executor, invoices, stripe_api
from agents.constants import IRREVERSIBLE_ACTIONS
from tests.memdb import MemoryDB


class FakeStripe:
    """Records every call; answers like Stripe would for the happy path."""

    def __init__(self, product_found=True, fail_on: str | None = None, invoice_status="paid"):
        self.calls: list[tuple] = []
        self.product_found = product_found
        self.fail_on = fail_on
        self.invoice_status = invoice_status

    def __call__(self, method, path, key, params=None, idempotency_key=None):
        self.calls.append((method, path, params or {}, idempotency_key))
        if self.fail_on and self.fail_on in path:
            raise stripe_api.StripeError("card network hiccup")
        if path == "/products/search":
            return {"data": [{"id": "prod_dil"}] if self.product_found else []}
        if path == "/customers" and method == "GET":
            return {"data": []}
        if path == "/customers":
            return {"id": "cus_1"}
        if path == "/invoices":
            return {"id": "in_1"}
        if path.endswith("/send"):
            return {"id": "in_1", "number": "MET-0001", "amount_due": 150000, "currency": "usd",
                    "due_date": 1_800_000_000, "hosted_invoice_url": "https://invoice.stripe.com/i/x"}
        if path.startswith("/invoices/") and method == "GET":
            return {"id": path.split("/")[-1], "status": self.invoice_status, "amount_paid": 150000,
                    "status_transitions": {"paid_at": 1_800_000_000}}
        return {}

    def paths(self):
        return [(m, p) for m, p, _, _ in self.calls]


@pytest.fixture
def db(monkeypatch):
    mem = MemoryDB()
    monkeypatch.setattr(executor, "SUPABASE", mem)
    monkeypatch.setattr(invoices, "SUPABASE", mem)
    return mem


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("STRIPE_INVOICE_KEY", "rk_test_write")
    monkeypatch.setenv("STRIPE_RESTRICTED_KEY", "rk_test_read")


def _approved(db, payload, **overrides):
    row = {
        "id": "q-1", "module": "finance", "action_type": "send_invoice", "summary": "invoice",
        "payload": payload, "status": "approved",
        "resolved_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
        "related_lead": None, "related_triage": None, **overrides,
    }
    db.tables.setdefault("approval_queue", []).append(row)
    return row


GOOD = {
    "customer_email": "cfo@acme.com", "customer_name": "Acme", "product": "diligence",
    "items": [{"description": "Diligence report", "amount": 1000, "quantity": 1},
              {"description": "Rush fee", "amount": 250, "quantity": 2}],
    "days_until_due": 14, "memo": "Thanks!",
}


def test_every_irreversible_action_has_an_executor():
    assert set(executor.HANDLERS) == IRREVERSIBLE_ACTIONS


def test_sends_invoice_once_with_idempotency_keys(db, keys, monkeypatch):
    fake = FakeStripe()
    monkeypatch.setattr(stripe_api, "request", fake)
    _approved(db, GOOD)
    assert executor.run_executor() == {"executed": 1, "failed": 0}
    assert executor.run_executor() == {"executed": 0, "failed": 0}

    writes = [c for c in fake.calls if c[0] == "POST"]
    assert all(c[3] and c[3].startswith("selene-q-1-") for c in writes)
    assert len({c[3] for c in writes}) == len(writes)  # one key per step

    items = [c[2] for c in fake.calls if c[1] == "/invoiceitems"]
    assert [i["price_data"] for i in items] == [
        {"currency": "usd", "product": "prod_dil", "unit_amount": 100000},
        {"currency": "usd", "product": "prod_dil", "unit_amount": 25000},
    ]
    assert items[1]["quantity"] == 2

    inv = next(c[2] for c in fake.calls if c[1] == "/invoices")
    assert inv["collection_method"] == "send_invoice" and inv["days_until_due"] == 14
    assert inv["metadata"] == {"approval_id": "q-1", "metis_product": "diligence"}

    assert fake.paths()[-2:] == [("POST", "/invoices/in_1/finalize"), ("POST", "/invoices/in_1/send")]
    rec = db.tables["invoices"][0]
    assert rec["stripe_invoice_id"] == "in_1" and rec["amount_due"] == 1500.0 and rec["status"] == "open"
    assert "MET-0001" in db.tables["approval_queue"][0]["result"]


def test_lead_linked_invoice_bills_the_lead(db, keys, monkeypatch):
    fake = FakeStripe()
    monkeypatch.setattr(stripe_api, "request", fake)
    db.tables["leads"] = [{"id": "lead-1", "email": "buyer@real.com", "name": "Real Buyer", "status": "qualified"}]
    _approved(db, {**GOOD, "customer_email": "attacker@evil.com"}, related_lead="lead-1")
    executor.run_executor()
    lookup = next(c[2] for c in fake.calls if c[1] == "/customers" and c[0] == "GET")
    assert lookup["email"] == "buyer@real.com"
    assert db.tables["invoices"][0]["lead_id"] == "lead-1"
    assert db.tables["lead_events"][0]["event_type"] == "invoiced"


@pytest.mark.parametrize("bad,why", [
    ({"items": []}, "at least one line item"),
    ({"items": [{"description": "x", "amount": -5}]}, "more than zero"),
    ({"items": [{"description": "x", "amount": "lots"}]}, "must be a number"),
    ({"items": [{"description": "x", "amount": 1, "quantity": True}]}, "quantity"),
    ({"items": [{"description": "x", "amount": 1}] * 21}, "line items"),
    ({"items": [{"description": "x", "amount": 300_000}]}, "over the"),
    ({"product": "crypto"}, "product must be"),
    ({"days_until_due": 365}, "days_until_due"),
    ({"customer_email": "nope"}, "customer email"),
])
def test_bad_invoice_payloads_never_touch_stripe(db, keys, monkeypatch, bad, why):
    fake = FakeStripe()
    monkeypatch.setattr(stripe_api, "request", fake)
    _approved(db, {**GOOD, **bad})
    executor.run_executor()
    row = db.tables["approval_queue"][0]
    assert row["status"] == "failed" and why in row["error"]
    assert fake.calls == []


def test_untagged_product_fails_before_creating_anything(db, keys, monkeypatch):
    fake = FakeStripe(product_found=False)
    monkeypatch.setattr(stripe_api, "request", fake)
    _approved(db, GOOD)
    executor.run_executor()
    assert "metis_product=diligence" in db.tables["approval_queue"][0]["error"]
    assert [c for c in fake.calls if c[0] == "POST"] == []


def test_failure_after_draft_names_the_draft(db, keys, monkeypatch):
    monkeypatch.setattr(stripe_api, "request", FakeStripe(fail_on="/finalize"))
    _approved(db, GOOD)
    executor.run_executor()
    row = db.tables["approval_queue"][0]
    assert row["status"] == "failed" and "in_1" in row["error"] and "not sent" in row["error"]
    assert "invoices" not in db.tables


def test_full_secret_key_is_refused(db, monkeypatch):
    monkeypatch.setenv("STRIPE_INVOICE_KEY", "sk_live_everything")
    fake = FakeStripe()
    monkeypatch.setattr(stripe_api, "request", fake)
    _approved(db, GOOD)
    executor.run_executor()
    assert "restricted key" in db.tables["approval_queue"][0]["error"]
    assert fake.calls == []


def test_encode_nests_like_stripe():
    assert stripe_api.encode({"a": {"b": 1}, "c": [{"d": "x"}], "e": True, "f": None}) == [
        ("a[b]", "1"), ("c[0][d]", "x"), ("e", "true"),
    ]


# ── status sync ──────────────────────────────────────────────


def _open_invoice(db, **kw):
    row = {"id": "inv-1", "stripe_invoice_id": "in_1", "number": "MET-0001", "customer_email": "cfo@acme.com",
           "customer_name": "Acme", "product": "diligence", "lead_id": None, "status": "open", **kw}
    db.tables.setdefault("invoices", []).append(row)
    return row


def test_paid_invoice_logs_revenue_once(db, keys, monkeypatch):
    monkeypatch.setattr(stripe_api, "request", FakeStripe(invoice_status="paid"))
    db.tables["leads"] = [{"id": "lead-1", "status": "qualified"}]
    _open_invoice(db, lead_id="lead-1")
    invoices.sync()
    db.tables["invoices"][0]["status"] = "open"  # pretend a second pass sees it again
    invoices.sync()

    ledger = db.tables["ledger"]
    assert len(ledger) == 1
    assert ledger[0]["amount"] == 1500.0 and ledger[0]["direction"] == "in" and ledger[0]["source_ref"] == "stripe:in_1"
    assert db.tables["leads"][0]["status"] == "closed"
    assert len([e for e in db.tables["lead_events"] if "invoice paid" in e["detail"]]) == 1


def test_still_open_invoice_is_quiet(db, keys, monkeypatch):
    monkeypatch.setattr(stripe_api, "request", FakeStripe(invoice_status="open"))
    _open_invoice(db)
    assert invoices.sync()["changed"] == 0
    assert "ledger" not in db.tables and "agent_runs" not in db.tables
    assert db.tables["invoices"][0]["synced_at"]


def test_one_bad_invoice_doesnt_stop_the_rest(db, keys, monkeypatch):
    fake = FakeStripe(invoice_status="void")
    real = fake.__call__

    def flaky(method, path, key, params=None, idempotency_key=None):
        if path == "/invoices/in_bad":
            raise stripe_api.StripeError("No such invoice")
        return real(method, path, key, params, idempotency_key)

    monkeypatch.setattr(stripe_api, "request", flaky)
    _open_invoice(db, id="inv-bad", stripe_invoice_id="in_bad")
    _open_invoice(db, id="inv-2", stripe_invoice_id="in_2")
    t = invoices.sync()
    assert t["failed"] == 1 and t["changed"] == 1
    assert db.tables["invoices"][1]["status"] == "void"
    assert db.tables["agent_runs"][0]["status"] == "failed"
