"""
SELENE OS — approval gate + idempotency tests
CLAUDE.md testing expectations:
  - unit-test the gate: every job x every irreversible action = denied
  - test idempotency: run each job twice on the same fixtures, no duplicates

"Denied" here means structural: no tool exists anywhere in this codebase
that directly executes send_email / add_ledger_entry / contact_lead /
update_lead_status. The only thing that can produce one of those
action_type values is propose_action, which always just inserts a *pending*
approval_queue row — never executes it. These tests assert that shape
holds, using a fake Supabase client so nothing here touches a real project.

Run: pip install pytest && python -m pytest tests/
"""

from __future__ import annotations

import pytest

from agents import mcp_tools
from agents.constants import ALL_TOOLS, IRREVERSIBLE_ACTIONS, JOB_ALLOWLISTS


class FakeResult:
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class FakeTable:
    def __init__(self, name: str, recorder: "FakeSupabase"):
        self.name = name
        self.recorder = recorder
        self._last_values: dict = {}

    def insert(self, values):
        self._last_values = values
        self.recorder.calls.append(("insert", self.name, values, None))
        return self

    def upsert(self, values, on_conflict=None):
        self._last_values = values
        self.recorder.calls.append(("upsert", self.name, values, on_conflict))
        return self

    def update(self, values):
        self._last_values = values
        self.recorder.calls.append(("update", self.name, values, None))
        return self

    def select(self, *_a, **_kw):
        return self

    def eq(self, *_a, **_kw):
        return self

    def gte(self, *_a, **_kw):
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        return FakeResult([{"id": "fake-id", **self._last_values}])


class FakeSupabase:
    """Minimal stand-in for the supabase-py client — just enough of the
    .table().insert/upsert/update().execute() chain that mcp_tools.py uses,
    recording every call so tests can assert on shape and intent."""

    def __init__(self):
        self.calls: list[tuple] = []

    def table(self, name: str) -> FakeTable:
        return FakeTable(name, self)


@pytest.fixture
def fake_supabase(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(mcp_tools, "SUPABASE", fake)
    return fake


# ============================================================
# Structural approval gate
# ============================================================


def test_no_job_allowlist_exposes_an_irreversible_action_as_a_tool():
    """No job may ever be handed a tool literally named after an
    irreversible action — the only path to one is propose_action's payload,
    which never executes anything itself."""
    for job, tools in JOB_ALLOWLISTS.items():
        overlap = tools & IRREVERSIBLE_ACTIONS
        assert not overlap, f"job {job!r} allowlists action-executing tool(s): {overlap}"


def test_every_allowlisted_tool_actually_exists():
    """Catches drift between constants.py's allowlists and what
    mcp_tools.py actually registers."""
    for job, tools in JOB_ALLOWLISTS.items():
        unknown = tools - ALL_TOOLS
        assert not unknown, f"job {job!r} allowlists unknown tool(s): {unknown}"


def test_propose_action_rejects_unknown_action_type(fake_supabase):
    with pytest.raises(ValueError):
        mcp_tools.propose_action(module="inbox", action_type="delete_everything", summary="x", payload={})
    assert fake_supabase.calls == []  # rejected before ever touching the DB


@pytest.mark.parametrize("action_type", sorted(IRREVERSIBLE_ACTIONS))
def test_propose_action_accepts_every_real_irreversible_action(action_type, fake_supabase):
    row_id = mcp_tools.propose_action(module="inbox", action_type=action_type, summary="x", payload={"k": "v"})
    assert row_id

    kind, table, values, _ = fake_supabase.calls[-1]
    assert (kind, table) == ("insert", "approval_queue")
    assert values["action_type"] == action_type
    # propose_action never sets status itself — the row lands 'pending' only
    # because that's the column default in schema.sql. If this ever starts
    # passing status explicitly, the gate is weaker than it looks.
    assert "status" not in values


# ============================================================
# Idempotency
# ============================================================


def test_record_triage_upserts_on_gmail_message_id_not_insert(fake_supabase):
    """Running the same message through twice must not create two rows —
    matches the unique constraint on gmail_message_id in schema.sql."""
    kwargs = dict(
        gmail_message_id="msg-1", received_at="2026-01-01T00:00:00Z",
        from_addr="a@b.com", subject="hi", bucket="vendor", summary="s", needs_reply=False,
    )
    mcp_tools.record_triage(**kwargs)
    mcp_tools.record_triage(**kwargs)

    assert len(fake_supabase.calls) == 2
    for kind, table, _values, on_conflict in fake_supabase.calls:
        assert (kind, table, on_conflict) == ("upsert", "inbox_triage", "gmail_message_id")


def test_save_brief_upserts_on_week_of_not_insert(fake_supabase):
    """Re-running the brief job for the same week overwrites, doesn't
    duplicate — matches the unique constraint on week_of in schema.sql."""
    mcp_tools.save_brief(week_of="2026-07-13", content_md="hi", stats={})
    mcp_tools.save_brief(week_of="2026-07-13", content_md="hi v2", stats={})

    assert len(fake_supabase.calls) == 2
    for kind, table, _values, on_conflict in fake_supabase.calls:
        assert (kind, table, on_conflict) == ("upsert", "briefs", "week_of")
