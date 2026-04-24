# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Log sanitization utilities for preventing sensitive data leakage.

Provides two layers of defense:

1. **Explicit utilities** — ``sanitize_url``, ``sanitize_params``,
   ``redact_token`` — called at logging call-sites for precise control.

2. **SensitiveDataFilter** — a ``logging.Filter`` registered on handlers
   as a safety net, automatically redacting patterns that slip through.

Usage::

    from data_formulator.security.log_sanitizer import (
        sanitize_url, sanitize_params, redact_token,
    )

    logger.info("Connected to %s", sanitize_url(url))
    logger.info("Params: %s", sanitize_params(params))
    logger.debug("Token: %s", redact_token(token))

The filter is registered in ``app.py:configure_logging()`` and can be
disabled via ``LOG_SANITIZE=false`` for local debugging.
"""

from __future__ import annotations

import copy
import logging
import os
import re
from typing import Any

# ---------------------------------------------------------------------------
# Sensitive key names (case-insensitive matching)
# ---------------------------------------------------------------------------

SENSITIVE_KEYS: frozenset[str] = frozenset({
    "password", "passwd", "pwd",
    "secret", "client_secret",
    "token", "access_token", "refresh_token",
    "api_key", "apikey", "api-key",
    "access_key", "secret_key", "secret_access_key",
    "credential", "credentials",
    "private_key", "private-key",
    "authorization",
    "connection_string", "conn_str",
})

_REDACTED = "***"
_REDACTED_TOKEN = "[REDACTED]"

# ---------------------------------------------------------------------------
# Pre-compiled regex patterns for the safety-net filter
# ---------------------------------------------------------------------------

# URL with embedded credentials: ://user:password@host
_RE_URL_CREDS = re.compile(
    r"(://[^/:@\s]+:)[^/@\s]+(@)",
)

# key=value patterns (password=xxx, api_key=xxx, secret=xxx, etc.)
_SENSITIVE_KEY_NAMES = (
    r"password|passwd|pwd|secret|client_secret"
    r"|token|access_token|refresh_token"
    r"|api_key|apikey|api[-_]key"
    r"|access_key|secret_key|secret_access_key"
    r"|credential|credentials"
    r"|private_key|private[-_]key"
    r"|authorization"
    r"|connection_string|conn_str"
)
_RE_KEY_VALUE = re.compile(
    rf"({_SENSITIVE_KEY_NAMES})"     # group 1: key name
    r"(\s*[=:]\s*)"                  # group 2: separator (= or :)
    r"(\S+)",                        # group 3: value
    re.IGNORECASE,
)

# Bearer token: Bearer eyJxxx... (long opaque strings)
_RE_BEARER = re.compile(
    r"(Bearer\s+)\S{12,}",
    re.IGNORECASE,
)

# Bare JWT-like strings: eyJ followed by 28+ base64url chars
_RE_JWT_LIKE = re.compile(
    r"\beyJ[A-Za-z0-9_-]{28,}",
)

# Python dict repr with sensitive keys: 'password': 'value' or "password": "value"
_RE_DICT_SENSITIVE = re.compile(
    rf"""(['"])({_SENSITIVE_KEY_NAMES})\1"""   # quoted key
    r"""(\s*:\s*)"""                            # colon separator
    r"""(['"])(.+?)\4""",                       # quoted value
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Explicit utility functions (Layer 1)
# ---------------------------------------------------------------------------

def sanitize_url(url: str) -> str:
    """Mask credentials embedded in a URL.

    ``https://user:s3cret@host/path`` → ``https://user:***@host/path``

    Safe to call on URLs without credentials (returns unchanged).
    """
    if not url or "://" not in url:
        return url
    return _RE_URL_CREDS.sub(rf"\g<1>{_REDACTED}\2", url)


def sanitize_params(params: dict[str, Any],
                    extra_keys: frozenset[str] | set[str] | None = None,
                    ) -> dict[str, Any]:
    """Return a shallow copy of *params* with sensitive values masked.

    Keys are matched case-insensitively against ``SENSITIVE_KEYS``
    (plus *extra_keys* when provided).
    """
    keys_to_mask = SENSITIVE_KEYS | (extra_keys or frozenset())
    sanitized = {}
    for k, v in params.items():
        if k.lower() in keys_to_mask:
            sanitized[k] = _REDACTED
        elif isinstance(v, dict):
            sanitized[k] = sanitize_params(v, extra_keys)
        else:
            sanitized[k] = v
    return sanitized


def redact_token(token: str, visible: int = 4) -> str:
    """Abbreviate a token to first/last *visible* characters.

    Short tokens (≤ 2×visible) are fully masked.

    ``"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.xxx"``
    → ``"eyJh...eCJ9"``  (visible=4)
    """
    if not token:
        return ""
    if len(token) <= visible * 2:
        return _REDACTED_TOKEN
    return f"{token[:visible]}...{token[-visible:]}"


# ---------------------------------------------------------------------------
# SensitiveDataFilter — logging.Filter safety net (Layer 2)
# ---------------------------------------------------------------------------

def _apply_patterns(text: str) -> str:
    """Run all redaction patterns on *text* and return the sanitized version."""
    # Order matters: most specific patterns first to avoid partial matches.
    text = _RE_URL_CREDS.sub(rf"\g<1>{_REDACTED}\2", text)
    text = _RE_BEARER.sub(rf"\g<1>{_REDACTED_TOKEN}", text)
    text = _RE_KEY_VALUE.sub(rf"\g<1>\g<2>{_REDACTED}", text)
    text = _RE_DICT_SENSITIVE.sub(
        rf"\g<1>\g<2>\g<1>\g<3>\g<4>{_REDACTED}\g<4>",
        text,
    )
    text = _RE_JWT_LIKE.sub(_REDACTED_TOKEN, text)
    return text


class SensitiveDataFilter(logging.Filter):
    """Safety-net filter that auto-redacts sensitive patterns in log messages.

    Attach to handlers in ``configure_logging()``::

        handler.addFilter(SensitiveDataFilter())

    Disable at runtime via ``LOG_SANITIZE=false``.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if os.environ.get("LOG_SANITIZE", "true").strip().lower() in (
            "false", "0", "no",
        ):
            return True

        # Format %-style args into the message so we can scan the full string.
        # After formatting we clear args to prevent double-formatting by the
        # handler's Formatter.
        if record.args:
            try:
                record.msg = record.msg % record.args
                record.args = None
            except (TypeError, ValueError):
                pass

        record.msg = _apply_patterns(str(record.msg))

        if record.exc_text:
            record.exc_text = _apply_patterns(record.exc_text)

        return True
