"""Thin wrapper around the Anthropic SDK that standardizes model selection,
prompt caching, and snippet truncation across the project."""

from __future__ import annotations

import logging

import anthropic

logger = logging.getLogger(__name__)

FAST_MODEL = "claude-haiku-4-5-20251001"
SNIPPET_MAX_CHARS = 300


def truncate_snippet(text: str, max_chars: int = SNIPPET_MAX_CHARS) -> str:
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def call_with_cached_system(
    client: anthropic.Anthropic,
    model: str,
    system_prompt: str,
    user_content: str,
    max_tokens: int,
) -> anthropic.types.Message:
    return client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_content}],
    )
