"""
SELENE OS — Gmail, send side
The only code in this repo that can send mail. Imported by agents/executor.py
and nothing else — selene.py and mcp_tools.py (everything the model can
reach) must never import it; tests/test_executor.py checks that.

Uses its own refresh token with the gmail.send scope, separate from the
gmail.readonly token the agent jobs use:
    GMAIL_SEND_REFRESH_TOKEN     # python -m agents.gmail_auth send
"""

from __future__ import annotations

import base64
from email.message import EmailMessage

import httpx

from agents.gmail import API, access_token


def build_mime(
    to: list[str],
    subject: str,
    body: str,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> str:
    """RFC 822 message, base64url-encoded the way messages.send wants it.
    From is left off — Gmail fills in the authenticated account."""
    msg = EmailMessage()
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = references or in_reply_to
    msg.set_content(body)
    return base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")


def send(
    to: list[str],
    subject: str,
    body: str,
    thread_id: str | None = None,
    in_reply_to: str | None = None,
    references: str | None = None,
) -> str:
    """Send one message. Returns Gmail's id for the sent message."""
    token = access_token("GMAIL_SEND_REFRESH_TOKEN")
    payload: dict[str, str] = {"raw": build_mime(to, subject, body, in_reply_to, references)}
    if thread_id:
        payload["threadId"] = thread_id
    res = httpx.post(f"{API}/messages/send", json=payload,
                     headers={"Authorization": f"Bearer {token}"}, timeout=30)
    res.raise_for_status()
    return res.json()["id"]
