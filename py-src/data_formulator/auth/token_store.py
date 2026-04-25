# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unified credential manager for all third-party systems.

Resolves credentials through a priority chain:
  cached → refresh → sso_exchange → delegated → vault → none.

All callers (Agent, DataConnector, routes) use the same interface.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from flask import session

logger = logging.getLogger(__name__)

_SSO_NS = "sso"
_SVC_NS = "service_tokens"
_SSO_BLOCKED_NS = "sso_disconnected_services"


class TokenStore:
    """Session-backed credential store with a six-level resolution chain."""

    # ── Core interface ────────────────────────────────────────

    def get_access(self, system_id: str) -> str | dict | None:
        """Return the best available credential for *system_id*.

        Returns an access_token string, a credentials dict, or ``None``.
        """
        config = self._get_auth_config(system_id)
        if not config:
            return None

        mode = config.get("mode", "credentials")

        # ① Cached token
        cached = self._get_cached(system_id)
        if cached and not self._is_expired(cached):
            return cached["access_token"]

        # ② Refresh
        if cached and cached.get("refresh_token"):
            refreshed = self._do_refresh(system_id, cached, config)
            if refreshed:
                return refreshed

        # ③ SSO Exchange
        if mode == "sso_exchange":
            exchanged = self._do_sso_exchange(system_id, config)
            if exchanged:
                return exchanged

        # ④ Delegated (popup-acquired token already in session)
        if mode == "delegated":
            delegated = self._get_cached(system_id)
            if delegated and not self._is_expired(delegated):
                return delegated["access_token"]

        # ⑤ Vault credentials
        vault_result = self._try_vault(system_id, config)
        if vault_result:
            return vault_result

        # ⑥ None
        return None

    def get_sso_token(self) -> str | None:
        """Return the DF-level SSO access token."""
        from data_formulator.auth.providers.oidc import is_backend_oidc_mode
        if is_backend_oidc_mode():
            sso = session.get(_SSO_NS)
            if not sso:
                return None
            if sso.get("expires_at", 0) < time.time():
                return self._refresh_sso()
            return sso.get("access_token")
        # Frontend mode: token lives on the request (Bearer header)
        try:
            from data_formulator.auth.identity import get_sso_token
            return get_sso_token()
        except Exception:
            return None

    def get_auth_status(self) -> dict[str, dict]:
        """Batch status check for all configured systems."""
        results = {}
        for system_id, config in self._all_auth_configs().items():
            access = self.get_access(system_id)
            results[system_id] = {
                "authorized": access is not None,
                "mode": config.get("mode"),
                "display_name": config.get("display_name", system_id),
                "requires_user_action": access is None,
                "available_strategies": self._available_strategies(
                    system_id, config),
            }
        return results

    # ── Store / clear ─────────────────────────────────────────

    def store_service_token(
        self,
        system_id: str,
        access_token: str,
        refresh_token: str | None = None,
        expires_in: int = 3600,
        user: dict | None = None,
    ) -> None:
        """Store a token acquired via popup or manual login."""
        tokens = session.get(_SVC_NS, {})
        tokens[system_id] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": time.time() + expires_in,
            "user": user,
            "stored_at": time.time(),
        }
        session[_SVC_NS] = tokens
        self.allow_sso_reconnect(system_id)

    def clear_service_token(self, system_id: str) -> None:
        """Clear cached token AND vault credentials for a system.

        Session + vault are always cleared together for explicit disconnect.
        SSO-backed systems are also blocked from auto-reconnecting in the
        current browser session until the user logs in again explicitly.
        """
        tokens = session.get(_SVC_NS, {})
        tokens.pop(system_id, None)
        session[_SVC_NS] = tokens
        self._vault_delete(system_id)
        config = self._get_auth_config(system_id) or {}
        if config.get("mode") == "sso_exchange":
            self.block_sso_reconnect(system_id)

    def clear_session_tokens(self) -> None:
        """Clear current-session SSO and service tokens without touching vault."""
        session.pop(_SSO_NS, None)
        session.pop(_SVC_NS, None)
        session.pop(_SSO_BLOCKED_NS, None)

    def block_sso_reconnect(self, system_id: str) -> None:
        """Prevent SSO auto-exchange for a system in this browser session."""
        blocked = session.get(_SSO_BLOCKED_NS, {})
        blocked[system_id] = True
        session[_SSO_BLOCKED_NS] = blocked

    def allow_sso_reconnect(self, system_id: str) -> None:
        """Allow SSO auto-exchange again after an explicit login."""
        blocked = session.get(_SSO_BLOCKED_NS, {})
        if system_id in blocked:
            blocked.pop(system_id, None)
            session[_SSO_BLOCKED_NS] = blocked

    def is_sso_reconnect_blocked(self, system_id: str) -> bool:
        """Return whether SSO auto-exchange is blocked for this system."""
        return bool(session.get(_SSO_BLOCKED_NS, {}).get(system_id))

    def store_sso_tokens(
        self,
        access_token: str,
        refresh_token: str | None = None,
        expires_in: int = 3600,
        user_info: dict | None = None,
    ) -> None:
        """Store SSO tokens after backend OIDC callback."""
        session[_SSO_NS] = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": time.time() + expires_in,
            "user": user_info,
        }

    # ── Internal: cache ───────────────────────────────────────

    def _get_cached(self, system_id: str) -> dict | None:
        tokens = session.get(_SVC_NS, {})
        return tokens.get(system_id)

    @staticmethod
    def _is_expired(cached: dict) -> bool:
        return cached.get("expires_at", 0) < time.time()

    # ── Internal: refresh ─────────────────────────────────────

    def _do_refresh(
        self, system_id: str, cached: dict, config: dict,
    ) -> str | None:
        """Refresh an expired token. Returns new access_token or None."""
        import requests as http

        token_url = config.get("token_url")
        if not token_url:
            return None
        try:
            resp = http.post(token_url, data={
                "grant_type": "refresh_token",
                "refresh_token": cached["refresh_token"],
                "client_id": self._resolve_env(
                    config.get("client_id_env", "")),
                "client_secret": self._resolve_env(
                    config.get("client_secret_env", "")),
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            self.store_service_token(
                system_id,
                access_token=data["access_token"],
                refresh_token=data.get(
                    "refresh_token", cached["refresh_token"]),
                expires_in=data.get("expires_in", 3600),
                user=cached.get("user"),
            )
            return data["access_token"]
        except Exception as exc:
            logger.debug("Refresh failed for %s: %s", system_id, exc)
            return None

    # ── Internal: SSO exchange ────────────────────────────────

    def _do_sso_exchange(
        self, system_id: str, config: dict,
    ) -> str | None:
        """Exchange SSO token for a system-specific token."""
        import requests as http

        if self.is_sso_reconnect_blocked(system_id):
            return None
        sso_token = self.get_sso_token()
        if not sso_token:
            return None
        exchange_url = config.get("exchange_url")
        if not exchange_url:
            return None
        try:
            resp = http.post(
                exchange_url,
                json={"sso_access_token": sso_token},
                timeout=config.get("timeout", 10),
            )
            resp.raise_for_status()
            data = resp.json()
            self.store_service_token(
                system_id,
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token"),
                expires_in=data.get("expires_in", 3600),
                user=data.get("user"),
            )
            return data["access_token"]
        except Exception as exc:
            logger.debug("SSO exchange failed for %s: %s", system_id, exc)
            return None

    # ── Internal: vault ───────────────────────────────────────

    def _try_vault(self, system_id: str, config: dict) -> dict | None:
        """Try vault credentials. Returns credentials dict or None."""
        creds = self._vault_retrieve(system_id)
        if not creds:
            return None
        return creds

    def _vault_retrieve(self, system_id: str) -> dict | None:
        try:
            from data_formulator.auth.identity import get_identity_id
            from data_formulator.auth.vault import get_credential_vault
            vault = get_credential_vault()
            if not vault:
                return None
            identity = get_identity_id()
            return vault.retrieve(identity, system_id)
        except Exception:
            return None

    def _vault_store(self, system_id: str, credentials: dict) -> None:
        try:
            from data_formulator.auth.identity import get_identity_id
            from data_formulator.auth.vault import get_credential_vault
            vault = get_credential_vault()
            if not vault:
                return
            identity = get_identity_id()
            vault.store(identity, system_id, credentials)
        except Exception:
            pass

    def _vault_delete(self, system_id: str) -> None:
        try:
            from data_formulator.auth.identity import get_identity_id
            from data_formulator.auth.vault import get_credential_vault
            vault = get_credential_vault()
            if not vault:
                return
            identity = get_identity_id()
            vault.delete(identity, system_id)
        except Exception:
            pass

    # ── Internal: SSO refresh ─────────────────────────────────

    def _refresh_sso(self) -> str | None:
        """Refresh the SSO token using refresh_token."""
        import requests as http

        sso = session.get(_SSO_NS, {})
        refresh = sso.get("refresh_token")
        if not refresh:
            return None
        token_url = os.environ.get("OIDC_TOKEN_URL", "")
        if not token_url:
            return None
        try:
            resp = http.post(token_url, data={
                "grant_type": "refresh_token",
                "refresh_token": refresh,
                "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
                "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
            }, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            self.store_sso_tokens(
                access_token=data["access_token"],
                refresh_token=data.get("refresh_token", refresh),
                expires_in=data.get("expires_in", 3600),
            )
            return data["access_token"]
        except Exception as exc:
            logger.debug("SSO refresh failed: %s", exc)
            return None

    # ── Internal: auth_config lookup ──────────────────────────

    def _get_auth_config(self, system_id: str) -> dict | None:
        configs = self._all_auth_configs()
        return configs.get(system_id)

    def _all_auth_configs(self) -> dict[str, dict]:
        """Collect auth_config from all registered Loaders."""
        try:
            from data_formulator.data_loader import DATA_LOADERS
        except ImportError:
            return {}
        result: dict[str, dict] = {}
        for loader_type, loader_class in DATA_LOADERS.items():
            if hasattr(loader_class, "auth_config"):
                config = loader_class.auth_config()
                if config and config.get("mode") != "credentials":
                    result[loader_type] = config
            elif hasattr(loader_class, "auth_mode"):
                mode = loader_class.auth_mode()
                if mode not in ("connection", "credentials", "none"):
                    result[loader_type] = {
                        "mode": mode,
                        "display_name": loader_type,
                    }
        return result

    def _available_strategies(
        self, system_id: str, config: dict,
    ) -> list[str]:
        """What can the user do to authenticate this system?"""
        strategies: list[str] = []
        mode = config.get("mode", "credentials")
        if (
            mode == "sso_exchange"
            and not self.is_sso_reconnect_blocked(system_id)
            and self.get_sso_token()
        ):
            strategies.append("sso_exchange")
        if config.get("login_url"):
            strategies.append("delegated_popup")
        if mode == "oauth2":
            strategies.append("oauth2_redirect")
        if mode in ("credentials", "connection"):
            strategies.append("manual_credentials")
        return strategies

    @staticmethod
    def _resolve_env(env_key: str) -> str:
        return os.environ.get(env_key, "") if env_key else ""
