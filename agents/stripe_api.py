"""
SELENE OS — minimal Stripe REST client
Plain httpx, no SDK. Which key a caller passes decides what it can do:

    STRIPE_INVOICE_KEY      restricted, write on Customers / Invoices /
                            Invoice items, read on Products. Used only by
                            agents/executor.py, after Nick approves.
    STRIPE_RESTRICTED_KEY   restricted, read-only. agents/invoices.py (status
                            sync) and the dashboard's revenue view.

Full secret keys (sk_...) are refused: neither job needs one, and one
could issue refunds or payouts. Nothing the model can reach imports this
module (tests/test_executor.py enforces it).

The API version is pinned so response shapes (invoice line `price`, etc.)
don't shift under us when the account's default version moves.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

API = "https://api.stripe.com/v1"
STRIPE_VERSION = "2024-06-20"


class StripeNotConfigured(RuntimeError):
    pass


class StripeError(RuntimeError):
    pass


def key_from_env(name: str) -> str:
    key = os.environ.get(name)
    if not key:
        raise StripeNotConfigured(f"{name} isn't set.")
    if key.startswith("sk_"):
        raise StripeNotConfigured(f"{name} is a full secret key. Use a restricted key (rk_...) instead.")
    return key


def encode(params: dict[str, Any], prefix: str = "") -> list[tuple[str, str]]:
    """Stripe's form encoding: nested dicts as a[b]=, lists as a[0]=,
    booleans as true/false. None values are dropped."""
    out: list[tuple[str, str]] = []
    for k, v in params.items():
        name = f"{prefix}[{k}]" if prefix else str(k)
        if v is None:
            continue
        if isinstance(v, dict):
            out += encode(v, name)
        elif isinstance(v, list):
            for i, item in enumerate(v):
                out += encode(item, f"{name}[{i}]") if isinstance(item, dict) else [(f"{name}[{i}]", str(item))]
        elif isinstance(v, bool):
            out.append((name, "true" if v else "false"))
        else:
            out.append((name, str(v)))
    return out


def request(
    method: str,
    path: str,
    key: str,
    params: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {key}", "Stripe-Version": STRIPE_VERSION}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    data = encode(params or {})
    if method == "GET":
        res = httpx.get(f"{API}{path}", params=data, headers=headers, timeout=30)
    else:
        res = httpx.post(f"{API}{path}", data=data, headers=headers, timeout=30)
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        raise StripeError(body.get("error", {}).get("message") or f"Stripe {res.status_code}")
    return body
