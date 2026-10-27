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
1. ``DF_CODE_SIGNING_SECRET`` env-var, when set (share it across instances
   behind a load balancer).
2. ``FLASK_SECRET_KEY`` env-var, when set: a key derived from it, so
   deployments that already share the Flask secret keep valid signatures.
3. Otherwise a random key created once per installation and kept in Data
   Formulator's home, so signatures survive restarts and reloads.
"""

import hashlib
import hmac
import logging
import os
import secrets

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Server-side secret
# ---------------------------------------------------------------------------

_KEY_FILE = ".code-signing-key"
_process_key: bytes | None = None


def _installation_key() -> bytes:
    """A random key created once and kept in Data Formulator's home (mode 0600)."""
    global _process_key
    from data_formulator.datalake.workspace import get_data_formulator_home

    path = get_data_formulator_home() / _KEY_FILE
    try:
        return bytes.fromhex(path.read_text().strip())
    except (OSError, ValueError):
        pass
    key = secrets.token_bytes(32)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(key.hex())
        return key
    except FileExistsError:
        return bytes.fromhex(path.read_text().strip())
    except OSError:
        # Read-only home: sign with a per-process key (signatures won't survive restarts).
        if _process_key is None:
            logger.warning("code_signing: cannot store a key in %s; using a per-process key", path.parent)
            _process_key = key
        return _process_key


def _get_secret() -> bytes:
    explicit = os.environ.get("DF_CODE_SIGNING_SECRET")
    if explicit:
        return explicit.encode("utf-8")
    flask_secret = os.environ.get("FLASK_SECRET_KEY")
    if flask_secret:
        # A separate derived key, so the Flask session secret is not reused as-is.
        return hmac.new(b"df-code-signing", flask_secret.encode("utf-8"), hashlib.sha256).digest()
    return _installation_key()


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
