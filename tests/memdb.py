"""In-memory stand-in for the supabase-py client: just enough of the
PostgREST query chain that agents/ uses, with real filtering and unique-key
upserts, so job logic can be tested without a project."""

from __future__ import annotations

import copy
from typing import Any


class _Result:
    def __init__(self, data: list[dict]):
        self.data = data
        self.count = len(data)


class Query:
    def __init__(self, db: "MemoryDB", table: str):
        self.db, self.table = db, table
        self.filters: list = []
        self.op = "select"
        self.values: Any = {}
        self.on_conflict: str | None = None
        self.ignore_duplicates = False
        self._limit: int | None = None
        self._order: str | None = None

    # ── verbs ──
    def select(self, *_a, **_kw):
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def upsert(self, values, on_conflict=None, ignore_duplicates=False, **_kw):
        self.op, self.values = "upsert", values
        self.on_conflict, self.ignore_duplicates = on_conflict, ignore_duplicates
        return self

    # ── filters ──
    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def lte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r[col] <= val)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r[col] < val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r[col] >= val)
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def order(self, col, desc=False):
        self._order = col
        return self

    def limit(self, n):
        self._limit = n
        return self

    # ── run ──
    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "insert":
            row = {"id": f"{self.table}-{len(rows) + 1}", **self.values}
            rows.append(row)
            return _Result([copy.deepcopy(row)])
        if self.op == "upsert":
            keys = (self.on_conflict or "id").split(",")
            match = next((r for r in rows if all(r.get(k) == self.values.get(k) for k in keys)), None)
            if match:
                if self.ignore_duplicates:
                    return _Result([])
                match.update(self.values)
                return _Result([copy.deepcopy(match)])
            row = {"id": f"{self.table}-{len(rows) + 1}", **self.values}
            rows.append(row)
            return _Result([copy.deepcopy(row)])
        hits = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "update":
            for r in hits:
                r.update(self.values)
        if self._order:
            hits.sort(key=lambda r: r.get(self._order) or "")
        if self._limit is not None:
            hits = hits[: self._limit]
        return _Result([copy.deepcopy(r) for r in hits])


class MemoryDB:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {}

    def table(self, name: str) -> Query:
        return Query(self, name)
