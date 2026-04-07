# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""URL allowlist for user-provided LLM API base URLs.

When a user adds a custom model via the UI, they can supply an arbitrary
``api_base`` URL.  The server then makes outbound HTTP requests to that
URL on behalf of the user.  Without validation this is a **Server-Side
Request Forgery (SSRF)** vector — a malicious ``api_base`` could target
internal services, cloud metadata endpoints, or private-network hosts.

This module provides a simple allowlist mechanism:

* **Open mode** (default): When ``DF_ALLOWED_API_BASES`` is not set,
  *all* URLs are permitted.  This is convenient for local development.
* **Enforce mode**: When ``DF_ALLOWED_API_BASES`` is set (comma-separated
  glob patterns), only URLs that match at least one pattern are allowed.

Empty / missing ``api_base`` is always permitted — it means the provider's
built-in default endpoint is used (e.g. ``https://api.openai.com/...``).

Global models (configured via server-side env vars) are trusted and must
**not** be validated through this allowlist — their ``api_base`` is set
by the operator, not the user.

Configuration
~~~~~~~~~~~~~
Set the ``DF_ALLOWED_API_BASES`` environment variable to a comma-separated
list of glob patterns::

    # Allow OpenAI, any Azure OpenAI endpoint, and a private gateway
    DF_ALLOWED_API_BASES=https://api.openai.com/*,https://*.openai.azure.com/*,https://llm-gateway.internal.example.com/*

Glob patterns use ``fnmatch`` semantics (``*`` matches anything, ``?``
matches a single character).  Matching is case-insensitive.
"""

from __future__ import annotations

import fnmatch
import logging
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowlist loading
# ---------------------------------------------------------------------------

_ENV_KEY = "DF_ALLOWED_API_BASES"


def _load_patterns() -> list[str] | None:
    """Return the allowlist patterns, or ``None`` for open mode."""
    raw = os.environ.get(_ENV_KEY, "").strip()
    if not raw:
        return None
    patterns = [p.strip().lower() for p in raw.split(",") if p.strip()]
    return patterns if patterns else None


def _is_allowlist_configured() -> bool:
    """Return ``True`` if an allowlist is active (enforce mode)."""
    return _load_patterns() is not None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_api_base(api_base: str | None) -> None:
    """Validate *api_base* against the configured allowlist.

    - ``None`` or empty string → always allowed (provider default).
    - Open mode (env var unset) → everything allowed.
    - Enforce mode → must match at least one pattern.

    Raises ``ValueError`` with a user-facing message on rejection.
    """
    # Empty means "use the provider default" — always OK.
    if not api_base:
        return

    patterns = _load_patterns()

    # Open mode — no restrictions.
    if patterns is None:
        return

    url_lower = api_base.lower()

    for pattern in patterns:
        if fnmatch.fnmatch(url_lower, pattern):
            return

    logger.warning(
        "Rejected api_base not in allowlist: %s",
        api_base[:120],
    )
    raise ValueError(
        f"The provided API base URL is not in the server's allowlist. "
        f"Contact your administrator to add it to {_ENV_KEY}."
    )
