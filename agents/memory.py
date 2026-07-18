"""
SELENE OS — persistent memory
Rebuilt from the server-rack build: SQLite-backed message log + durable facts,
so Selene opens each session already knowing things (no 50 First Dates).

New in this version: optional one-way sync of facts up to Supabase
(selene_facts table) so the Selene OS dashboard and scheduled agent share
the same memory. Sync only runs if SUPABASE_URL is configured — the chat
loop works fully offline without it.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

DB_PATH = os.environ.get("SELENE_DB", "selene_memory.db")

_SCHEMA = """
create table if not exists messages (
  id integer primary key autoincrement,
  ts text not null,
  role text not null check (role in ('user','assistant','tool')),
  content text not null
);
create table if not exists facts (
  id integer primary key autoincrement,
  ts text not null,
  fact text not null,
  synced integer not null default 0
);
"""


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(_SCHEMA)
    return conn


def log_message(role: str, content: str) -> None:
    with _conn() as c:
        c.execute(
            "insert into messages (ts, role, content) values (?,?,?)",
            (datetime.now(timezone.utc).isoformat(), role, content),
        )


def recent_messages(limit: int = 30) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "select role, content from messages order by id desc limit ?", (limit,)
        ).fetchall()
    return [{"role": r, "content": t} for r, t in reversed(rows)]


def remember_fact(fact: str) -> str:
    with _conn() as c:
        c.execute(
            "insert into facts (ts, fact) values (?,?)",
            (datetime.now(timezone.utc).isoformat(), fact),
        )
    _try_sync()
    return f"Noted: {fact}"


def known_facts(cap: int = 100) -> list[str]:
    """Capped so the system prompt can't grow unbounded — the fix we flagged
    in the original build. Newest facts win."""
    with _conn() as c:
        rows = c.execute("select fact from facts order by id desc limit ?", (cap,)).fetchall()
    return [f for (f,) in reversed(rows)]


def _try_sync() -> None:
    """Push unsynced facts to Supabase selene_facts if configured. Best-effort;
    never blocks or breaks the chat loop."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        return
    try:
        from supabase import create_client

        sb = create_client(url, key)
        with _conn() as c:
            rows = c.execute("select id, fact from facts where synced = 0").fetchall()
            for fid, fact in rows:
                sb.table("selene_facts").insert(
                    {"fact": fact, "source": "conversation"}
                ).execute()
                c.execute("update facts set synced = 1 where id = ?", (fid,))
    except Exception:
        pass  # offline or misconfigured — local memory is still the source of truth
