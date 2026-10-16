"""
SELENE OS — compliance clock tests (pure code, CLAUDE.md non-negotiable #3)
  - an overdue deadline is never rolled forward silently
  - a completed recurring deadline spawns exactly one next occurrence
  - auto-renewing contracts roll forward; fixed-term ones expire
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from agents import selene
from tests.memdb import MemoryDB

TODAY = date.today()


def _iso(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.fixture
def db(monkeypatch):
    mem = MemoryDB()
    finished: list[tuple] = []
    monkeypatch.setattr(selene, "SUPABASE", mem)
    monkeypatch.setattr(selene, "_start_run", lambda job: ("run-1", "now"))
    monkeypatch.setattr(selene, "_finish_run", lambda run_id, status, **f: finished.append((status, f)))
    mem.finished = finished
    return mem


def test_overdue_recurring_deadline_stays_put(db):
    db.tables["deadlines"] = [{"id": "d1", "title": "CA SOI", "kind": "state", "due_date": _iso(-3),
                               "recurrence": "biennial", "status": "open"}]
    selene.run_compliance()
    assert db.tables["deadlines"] == [{"id": "d1", "title": "CA SOI", "kind": "state", "due_date": _iso(-3),
                                       "recurrence": "biennial", "status": "open"}]
    assert db.finished[-1][0] == "ok"


def test_done_recurring_deadline_spawns_next_once(db):
    db.tables["deadlines"] = [{"id": "d1", "title": "Franchise tax", "kind": "tax", "due_date": "2027-04-15",
                               "recurrence": "annual", "status": "done", "notes": "n"}]
    selene.run_compliance()
    selene.run_compliance()  # idempotent
    spawned = [d for d in db.tables["deadlines"] if d.get("source_ref") == "recur:d1"]
    assert len(spawned) == 1
    assert spawned[0]["due_date"] == "2028-04-15" and spawned[0]["kind"] == "tax"
    assert "status" not in spawned[0]  # lands 'open' via the column default


def test_biennial_from_leap_day_clamps():
    assert selene.add_months(date(2028, 2, 29), 24) == date(2030, 2, 28)
    assert selene.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert selene.add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)


def test_auto_renewing_contract_rolls_past_today(db):
    db.tables["contracts"] = [{"id": "c1", "status": "signed", "auto_renews": True, "renewal_months": 1,
                               "ends_on": _iso(-75)}]
    selene.run_compliance()
    ends = date.fromisoformat(db.tables["contracts"][0]["ends_on"])
    assert TODAY <= ends < TODAY + timedelta(days=32)
    assert db.tables["contracts"][0]["status"] == "signed"


def test_fixed_term_contract_expires(db):
    db.tables["contracts"] = [{"id": "c1", "status": "signed", "auto_renews": False, "ends_on": _iso(-1)}]
    selene.run_compliance()
    assert db.tables["contracts"][0]["status"] == "expired"


def test_future_and_unsigned_contracts_untouched(db):
    db.tables["contracts"] = [
        {"id": "c1", "status": "signed", "auto_renews": False, "ends_on": _iso(10)},
        {"id": "c2", "status": "sent", "auto_renews": False, "ends_on": _iso(-10)},
    ]
    selene.run_compliance()
    assert [c["status"] for c in db.tables["contracts"]] == ["signed", "sent"]
