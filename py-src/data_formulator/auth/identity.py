# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Authentication and identity management for Data Formulator.

Pluggable single-provider model with anonymous fallback::

    AUTH_PROVIDER=oidc            → OIDCProvider   → user:<sub>
    AUTH_PROVIDER=azure_easyauth  → AzureEasyAuth  → user:<principal>
    (not set, localhost)          → single-user     → local:<os_username>
    (not set, 0.0.0.0)           → anonymous only  → browser:<uuid>

Security Model:
- Local users: Fixed OS-derived identity (single-user localhost only)
- Anonymous users: Browser UUID from X-Identity-Id header (prefixed with "browser:")
- Authenticated users: Verified identity from a configured AuthProvider (prefixed with "user:")
- Namespacing ensures authenticated user data cannot be accessed by spoofing headers
"""

import getpass
import logging
import os
import re
from typing import Optional

from flask import Flask, g, request

from data_formulator.auth.providers import (
    get_provider_class,
    list_available_providers,
)
from data_formulator.auth.providers.base import (
    AuthenticationError,
    AuthProvider,
    AuthResult,
)

logger = logging.getLogger(__name__)

# Maximum raw length for identity values (before namespacing).
_MAX_IDENTITY_LENGTH = 256

# Allowed characters: word chars, @, dot, dash, plus, colon, pipe.
# Covers emails, UUIDs, OIDC sub claims (e.g. "auth0|5f…", "github:123").
# Deliberately excludes '/' (path traversal), spaces, and shell metacharacters.
_IDENTITY_RE = re.compile(r'^[\w@.\-+:|]+$', re.ASCII)

# Active provider instance, set by init_auth().
_provider: Optional[AuthProvider] = None

# Whether unauthenticated requests may fall back to browser UUID identity.
_allow_anonymous: bool = True

# Single-user localhost mode: use fixed OS-derived identity instead of
# trusting the client-provided X-Identity-Id header.
_localhost_identity: Optional[str] = None


def _validate_identity_value(value: str, source: str) -> str:
    """Validate and return a trimmed identity value.

    Raises ``ValueError`` if the value is empty, too long, or contains
    characters that should never appear in an identity string (e.g.
    path separators, control characters, shell metacharacters).
    """
    value = value.strip()
    if not value:
        raise ValueError(f"Empty identity value from {source}")
    if len(value) > _MAX_IDENTITY_LENGTH:
        raise ValueError(
            f"Identity value from {source} exceeds "
            f"{_MAX_IDENTITY_LENGTH} characters"
        )
    if not _IDENTITY_RE.match(value):
        raise ValueError(
            f"Identity value from {source} contains disallowed characters"
        )
    return value


def init_auth(app: Flask) -> None:
    """Initialise the authentication subsystem.  Call once after app creation.

    Reads ``AUTH_PROVIDER`` to select a provider and ``ALLOW_ANONYMOUS``
    to control whether unauthenticated requests are permitted.

    When no provider is configured and the server is bound to a
    loopback address (``127.0.0.1`` / ``localhost``), enables
    single-user localhost mode with a fixed ``local:<os_username>``
    identity.
    """
    global _provider, _allow_anonymous, _localhost_identity

    _allow_anonymous = os.environ.get(
        "ALLOW_ANONYMOUS", "true"
    ).lower() in ("true", "1", "yes")

    provider_name = os.environ.get("AUTH_PROVIDER", "").strip().lower()

    if not provider_name or provider_name == "anonymous":
        # Determine if single-user localhost mode applies.
        host = app.config.get('CLI_ARGS', {}).get('host', os.environ.get('HOST', '127.0.0.1'))
        if host in ('127.0.0.1', 'localhost', '::1'):
            try:
                username = getpass.getuser()
                validated = _validate_identity_value(username, "os_username")
                _localhost_identity = f"local:{validated}"
                logger.info(
                    "Auth mode: single-user localhost (identity=%s)",
                    _localhost_identity,
                )
            except Exception:
                logger.warning(
                    "Could not determine OS username; falling back to anonymous mode"
                )
                logger.info("Auth mode: anonymous only (no AUTH_PROVIDER configured)")
        else:
            logger.info("Auth mode: anonymous only (no AUTH_PROVIDER configured)")
        return

    provider_cls = get_provider_class(provider_name)
    if not provider_cls:
        logger.error(
            "Unknown AUTH_PROVIDER: '%s'. Available: %s",
            provider_name,
            ", ".join(list_available_providers()),
        )
        return

    try:
        provider: AuthProvider = provider_cls()

        if not provider.enabled:
            logger.error(
                "AUTH_PROVIDER='%s' is set but required configuration is "
                "missing. Provider will NOT be activated. "
                "Check environment variables.",
                provider_name,
            )
            return

        provider.on_configure(app)
        _provider = provider
        logger.info("Auth provider '%s' activated", provider_name)
    except Exception:
        logger.exception("Auth provider '%s' failed to initialise", provider_name)

    logger.info(
        "Auth mode: %s%s",
        provider_name or "anonymous",
        " + anonymous fallback" if _allow_anonymous else " (login required)",
    )


def get_identity_id() -> str:
    """Return the namespaced identity for the current request.

    Resolution order:

    1. Active AuthProvider → ``user:<verified_id>``
    2. Single-user localhost → ``local:<os_username>``
    3. Anonymous fallback (``ALLOW_ANONYMOUS=true``) → ``browser:<uuid>``
    4. Neither → ``ValueError``

    Returns:
        ``"user:<id>"``, ``"local:<username>"``, or ``"browser:<id>"``

    Raises:
        ValueError: when no identity can be determined.
    """
    # --- try the configured provider -----------------------------------
    if _provider:
        try:
            result = _provider.authenticate(request)
            if result is not None:
                validated = _validate_identity_value(result.user_id, _provider.name)
                logger.debug(
                    "Authenticated via %s: user:%s...",
                    _provider.name,
                    validated[:8],
                )
                g.df_auth_result = result
                return f"user:{validated}"
        except AuthenticationError as e:
            logger.warning(
                "Auth provider '%s' rejected request: %s", e.provider, e,
            )
            raise ValueError(f"Authentication failed: {e}")

    # --- single-user localhost -----------------------------------------
    if _localhost_identity:
        return _localhost_identity

    # --- anonymous fallback --------------------------------------------
    if _allow_anonymous:
        client_identity = request.headers.get("X-Identity-Id")
        if client_identity:
            if ":" in client_identity:
                identity_value = client_identity.split(":", 1)[1]
            else:
                identity_value = client_identity
            validated = _validate_identity_value(
                identity_value, "X-Identity-Id header",
            )
            return f"browser:{validated}"

        raise ValueError(
            "X-Identity-Id header is required. Please refresh the page."
        )

    raise ValueError("Authentication required. Please log in.")


def get_auth_result() -> Optional[AuthResult]:
    """Return the full :class:`AuthResult` for the current request.

    Only available after :func:`get_identity_id` authenticated via a
    provider (i.e. the identity starts with ``user:``).  Returns
    ``None`` for anonymous / browser identities.
    """
    return getattr(g, "df_auth_result", None)


def get_sso_token() -> Optional[str]:
    """Return the raw SSO access-token for the current request.

    Useful for pass-through to external systems that share the same IdP.
    Returns ``None`` when the user is anonymous or the provider does not
    supply a token.
    """
    result = get_auth_result()
    return result.raw_token if result else None


def get_active_provider() -> Optional[AuthProvider]:
    """Return the currently active provider, or ``None`` in anonymous mode."""
    return _provider
