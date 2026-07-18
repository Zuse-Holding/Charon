"""
SELENE OS — model provider layer
Runs Selene without an Anthropic API key.

Providers (pick via SELENE_PROVIDER env var):
  groq    — uses your existing GROQ_API_KEY. OpenAI-compatible endpoint. Default.
  ollama  — fully local, zero keys, zero cost. Needs `ollama serve` running.
  anthropic — optional, only if ANTHROPIC_API_KEY is ever set.

All three speak the OpenAI chat-completions format (Anthropic via its own SDK,
adapted), so selene_chat.py's tool loop is provider-agnostic.

pip install openai   (used as the client for groq + ollama)
"""

from __future__ import annotations

import os
from openai import OpenAI

PROVIDER = os.environ.get("SELENE_PROVIDER", "groq").lower()

_CONFIGS = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "api_key_env": "GROQ_API_KEY",
        # Solid tool-calling open model on Groq; swap freely.
        "default_model": os.environ.get("SELENE_GROQ_MODEL", "llama-3.3-70b-versatile"),
    },
    "ollama": {
        "base_url": os.environ.get("OLLAMA_URL", "http://localhost:11434/v1"),
        "api_key_env": None,  # none needed; client requires a placeholder string
        # On the Pi, stay small (qwen2.5:7b / llama3.1:8b). On a real box, go bigger.
        "default_model": os.environ.get("SELENE_OLLAMA_MODEL", "qwen2.5:7b"),
    },
}


def get_client() -> tuple[OpenAI, str]:
    """Returns (client, model_name) for the active provider."""
    if PROVIDER == "anthropic":
        raise RuntimeError(
            "No Anthropic provider here — agents/selene.py (the cron jobs) runs "
            "on `claude -p` headless subprocess calls, not this OpenAI-compatible "
            "client interface. If you want Claude in this chat loop too, that "
            "needs its own adapter (subprocess to `claude -p`, or the Anthropic "
            "Messages API with a real ANTHROPIC_API_KEY) — this module only "
            "speaks the OpenAI chat-completions shape."
        )
    cfg = _CONFIGS.get(PROVIDER)
    if not cfg:
        raise RuntimeError(f"Unknown SELENE_PROVIDER '{PROVIDER}'. Use: groq | ollama")

    key = os.environ.get(cfg["api_key_env"], "") if cfg["api_key_env"] else "local"
    if cfg["api_key_env"] and not key:
        raise RuntimeError(f"{cfg['api_key_env']} not set (required for provider '{PROVIDER}')")

    return OpenAI(base_url=cfg["base_url"], api_key=key), cfg["default_model"]
