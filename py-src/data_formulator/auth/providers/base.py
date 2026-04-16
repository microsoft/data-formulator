# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Base classes for the pluggable authentication provider system.

AuthProvider subclasses are auto-discovered at startup. Each provider
extracts and verifies user identity from an incoming Flask request.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Optional

from flask import Flask, Request


@dataclass
class AuthResult:
    """Successful authentication outcome.

    ``raw_token`` carries the original access_token so that downstream
    code (e.g. SSO pass-through to external BI systems) can reuse it
    without a second authentication round-trip.
    """

    user_id: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    raw_token: Optional[str] = None


class AuthProvider(ABC):
    """Abstract base for authentication providers.

    Lifecycle:
        1. ``__init__``  -- read env vars / lightweight setup
        2. ``enabled``   -- checked by ``init_auth()``; False → skip
        3. ``on_configure(app)`` -- called once after Flask app is ready
        4. ``authenticate(request)`` -- called on every incoming request

    Return conventions for ``authenticate``:
        * ``AuthResult`` → authentication succeeded
        * ``None``       → this provider does not apply (no matching
          credentials in the request); fall through to anonymous
        * raise ``AuthenticationError`` → credentials *are* present but
          invalid (expired token, bad signature, …)
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Short identifier used in AUTH_PROVIDER env var and logs."""
        ...

    @abstractmethod
    def authenticate(self, request: Request) -> Optional[AuthResult]:
        """Try to extract a verified identity from *request*."""
        ...

    @property
    def enabled(self) -> bool:
        """Whether required configuration (env vars, etc.) is present."""
        return True

    def on_configure(self, app: Flask) -> None:
        """Called once after the Flask app is created (e.g. fetch JWKS)."""

    def get_auth_info(self) -> dict[str, Any]:
        """Describe this provider to the frontend via ``/api/auth/info``.

        The ``action`` field tells the frontend how to initiate login:
        ``"frontend"`` (OIDC PKCE), ``"redirect"`` (server-side OAuth),
        ``"form"`` (username/password), ``"transparent"`` (header-based),
        or ``"none"`` (anonymous).
        """
        return {"action": "none"}


class AuthenticationError(Exception):
    """Raised when credentials are present but verification fails."""

    def __init__(self, message: str, provider: str = ""):
        self.provider = provider
        super().__init__(message)
