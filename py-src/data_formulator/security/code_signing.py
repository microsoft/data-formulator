# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""HMAC-based code signing for transformation code.

When the agent generates Python transformation code and the server
executes it successfully, the server signs the code with a secret key.
The signature is returned to the frontend alongside the code.

When the frontend later sends the code back for re-execution (e.g.
during data refresh), the server verifies the signature before running
the code.  This prevents a tampered or injected script from being
executed by the sandbox.

Secret lifecycle
~~~~~~~~~~~~~~~~
- **Dev mode** (``--dev``): uses a fixed, deterministic key so that
  signatures survive reloader restarts and hot-reloads during
  development.  This is *not* secure for production.
- **Production**: derives the key from Flask's ``app.secret_key``.
  For multi-worker deploys (gunicorn) set the ``SECRET_KEY`` env-var
  so all workers share the same Flask secret.
- **Explicit override**: set ``DF_CODE_SIGNING_SECRET`` env-var — this
  takes priority over everything (useful for multi-instance deploys
  behind a load balancer).
"""

import hashlib
import hmac
import logging
import os

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Server-side secret
# ---------------------------------------------------------------------------

# Explicit env-var takes highest priority (for multi-instance deploys).
_EXPLICIT_SECRET: str | None = os.environ.get("DF_CODE_SIGNING_SECRET") or None

# Fixed key used in dev mode so reloader restarts don't invalidate
# existing signatures.  NOT suitable for production.
_DEV_SECRET = b"data-formulator-dev-signing-key"


def _is_dev_mode() -> bool:
    """Return True if the server was started with ``--dev``."""
    try:
        from flask import current_app
        return current_app.config.get("CLI_ARGS", {}).get("dev", False)
    except (ImportError, RuntimeError):
        return False


def _get_secret() -> bytes:
    """Return the signing secret.

    Priority:
    1. ``DF_CODE_SIGNING_SECRET`` env-var  (set once, works everywhere)
    2. Dev mode → fixed deterministic key (survives reloader restarts)
    3. Production → derived from Flask ``app.secret_key``
    4. Fallback for tests / non-Flask callers
    """
    if _EXPLICIT_SECRET:
        return _EXPLICIT_SECRET.encode("utf-8")

    # In dev mode use a fixed key so the reloader doesn't break sigs.
    if _is_dev_mode():
        return _DEV_SECRET

    # Production: derive from Flask's secret_key.
    try:
        from flask import current_app
        flask_secret = current_app.secret_key
        if flask_secret:
            # Derive a separate key so changing Flask's secret_key for
            # session purposes doesn't accidentally share material.
            return hmac.new(
                b"df-code-signing",
                str(flask_secret).encode("utf-8"),
                hashlib.sha256,
            ).digest()
    except (ImportError, RuntimeError):
        # No Flask app context (e.g. unit tests, CLI scripts).
        pass

    # Last resort — should only happen in tests.
    logger.warning(
        "code_signing: no DF_CODE_SIGNING_SECRET and no Flask app context; "
        "using fallback secret (signatures won't survive restarts)"
    )
    return _DEV_SECRET


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# Maximum code size we are willing to sign / verify (256 KB).
MAX_CODE_SIZE = 256 * 1024


def sign_code(code: str) -> str:
    """Compute an HMAC-SHA256 signature over *code*.

    Returns the hex-encoded signature string.  The signature covers
    the raw UTF-8 bytes of *code* — whitespace and encoding matter.
    """
    if not code:
        return ""
    return hmac.new(
        _get_secret(),
        code.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_code(code: str, signature: str) -> bool:
    """Return ``True`` if *signature* is a valid HMAC for *code*.

    Uses constant-time comparison to prevent timing attacks.
    """
    if not code or not signature:
        return False
    expected = sign_code(code)
    return hmac.compare_digest(expected, signature)


def sign_result(result: dict) -> dict:
    """Add ``code_signature`` to an agent result dict (in-place).

    If the result contains a non-empty ``code`` key, a signature is
    computed and stored under ``code_signature``.  The result dict is
    returned for convenience.
    """
    code = result.get("code", "")
    if code:
        result["code_signature"] = sign_code(code)
    return result
