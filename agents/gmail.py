"""
SELENE OS — Gmail, read side
Pulls mail for the inbox and finance jobs with a gmail.readonly token. The
model never gets a Gmail tool at all: this module fetches, Python dedupes
and tracks the cursor, and the messages go into the prompt as untrusted
data — the same shape run_enrichment() already uses for leads. That's a
smaller surface than a Gmail MCP server (no tool to misuse, no send scope
anywhere near the agent) and keeps idempotency in plain code.

Sending lives in agents/gmail_send.py, with its own gmail.send token, and is
imported only by agents/executor.py — never by selene.py or mcp_tools.py.
tests/test_executor.py asserts that.

Env (agent box only):
    GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET
    GMAIL_READ_REFRESH_TOKEN     # gmail.readonly — get one with
                                 # python -m agents.gmail_auth read
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from typing import Any

import httpx

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://gmail.googleapis.com/gmail/v1/users/me"
BODY_LIMIT = 4000  # chars per message handed to the model


class GmailNotConfigured(RuntimeError):
    pass


def access_token(refresh_env: str) -> str:
    """Exchange the refresh token named by refresh_env for a short-lived
    access token. Each scope has its own refresh token, so which env var is
    read decides what this token can do."""
    client_id = os.environ.get("GMAIL_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GMAIL_OAUTH_CLIENT_SECRET")
    refresh = os.environ.get(refresh_env)
    if not (client_id and client_secret and refresh):
        raise GmailNotConfigured(
            f"Gmail not configured — set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET and {refresh_env}."
        )
    res = httpx.post(TOKEN_URL, data={
        "client_id": client_id, "client_secret": client_secret,
        "refresh_token": refresh, "grant_type": "refresh_token",
    }, timeout=30)
    res.raise_for_status()
    return res.json()["access_token"]


@dataclass
class Message:
    id: str
    thread_id: str
    internal_ms: int
    received_at: str  # ISO 8601
    from_addr: str
    to_addr: str
    subject: str
    message_id_header: str  # RFC 822 Message-ID, for threading replies
    body: str

    def as_prompt_block(self) -> str:
        return (
            f'<untrusted_email gmail_message_id="{self.id}" thread_id="{self.thread_id}" '
            f'message_id_header="{self.message_id_header}" received_at="{self.received_at}">\n'
            f"From: {self.from_addr}\nTo: {self.to_addr}\nSubject: {self.subject}\n\n"
            f"{self.body}\n</untrusted_email>"
        )


def _header(headers: list[dict[str, str]], name: str) -> str:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _strip_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", unescape(html)).strip()


def extract_body(payload: dict[str, Any]) -> str:
    """Prefer text/plain anywhere in the MIME tree; fall back to stripped
    text/html. Attachments are ignored."""
    plain: list[str] = []
    html: list[str] = []

    def walk(part: dict[str, Any]) -> None:
        mime = part.get("mimeType", "")
        data = part.get("body", {}).get("data")
        if data and not part.get("filename"):
            if mime == "text/plain":
                plain.append(_decode(data))
            elif mime == "text/html":
                html.append(_decode(data))
        for sub in part.get("parts", []) or []:
            walk(sub)

    walk(payload)
    text = "\n".join(plain).strip() or _strip_html("\n".join(html))
    return text[:BODY_LIMIT] + ("\n[truncated]" if len(text) > BODY_LIMIT else "")


class GmailReader:
    """Read-only client. There is deliberately no send/modify method here."""

    def __init__(self, token: str | None = None):
        self._token = token or access_token("GMAIL_READ_REFRESH_TOKEN")

    def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        res = httpx.get(f"{API}{path}", params=params,
                        headers={"Authorization": f"Bearer {self._token}"}, timeout=30)
        res.raise_for_status()
        return res.json()

    def list_ids(self, query: str, cap: int = 200) -> list[str]:
        ids: list[str] = []
        page: str | None = None
        while len(ids) < cap:
            params: dict[str, Any] = {"q": query, "maxResults": min(100, cap - len(ids))}
            if page:
                params["pageToken"] = page
            data = self._get("/messages", params)
            ids += [m["id"] for m in data.get("messages", [])]
            page = data.get("nextPageToken")
            if not page:
                break
        return ids

    def get(self, msg_id: str) -> Message:
        data = self._get(f"/messages/{msg_id}", {"format": "full"})
        headers = data.get("payload", {}).get("headers", [])
        internal_ms = int(data.get("internalDate", "0"))
        return Message(
            id=data["id"],
            thread_id=data.get("threadId", ""),
            internal_ms=internal_ms,
            received_at=datetime.fromtimestamp(internal_ms / 1000, tz=timezone.utc).isoformat(),
            from_addr=_header(headers, "From"),
            to_addr=_header(headers, "To"),
            subject=_header(headers, "Subject"),
            message_id_header=_header(headers, "Message-ID"),
            body=extract_body(data.get("payload", {})),
        )


def query_since(base_query: str, cursor_ms: str | None, first_run_query: str) -> str:
    """Gmail's after: takes epoch seconds. Back off one second so messages
    sharing the cursor's second aren't skipped — callers dedupe anyway."""
    if not cursor_ms:
        return f"{base_query} {first_run_query}".strip()
    return f"{base_query} after:{int(cursor_ms) // 1000 - 1}".strip()


def fetch_new(reader: GmailReader, ids: list[str], seen_ids: set[str], batch: int) -> list[Message]:
    """Oldest-first batch of the given message ids that aren't in seen_ids.
    Oldest-first so a capped batch advances the cursor without skipping
    anything older that's still waiting."""
    fresh = [i for i in ids if i not in seen_ids]
    messages = sorted((reader.get(i) for i in fresh), key=lambda m: m.internal_ms)
    return messages[:batch]
