# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""DataConnector — generic lifecycle wrapper for ExternalDataLoader.

Takes any ``ExternalDataLoader`` class and auto-generates a Flask Blueprint
with auth / catalog / data routes.  No per-connector code needed.

Usage::

    from data_formulator.data_connector import DataConnector

    connector = DataConnector.from_loader(
        PostgreSQLDataLoader,
        source_id="pg_prod",
        display_name="Production DB",
        default_params={"host": "db.corp", "database": "prod"},
    )
    app.register_blueprint(connector.create_blueprint())
"""

import dataclasses
import inspect
import json as _json
import logging
from pathlib import Path
from typing import Any

from flask import Blueprint, Flask, jsonify, request

from data_formulator.data_loader.external_data_loader import (
    CatalogNode,
    ExternalDataLoader,
    SENSITIVE_PARAMS,
)
from data_formulator.security.sanitize import sanitize_error_message

logger = logging.getLogger(__name__)

# Registry of enabled DataConnector instances (populated at startup).
DATA_CONNECTORS: dict[str, "DataConnector"] = {}

_MAX_CATALOG_PAGE_SIZE = 1000
_USER_CONNECTOR_PREFIX = "user::"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def classify_and_raise_connector_error(error: Exception) -> None:
    """Classify a connector error and raise ``AppError``.

    Preserves actionable detail for known error categories while keeping
    sanitized internals in ``detail`` (only exposed in debug mode).
    """
    from data_formulator.errors import AppError, ErrorCode

    logger.error("DataConnector error", exc_info=error)
    raw = str(error)
    msg = raw.lower()
    safe_detail = sanitize_error_message(raw)

    if any(kw in msg for kw in ("authenticat", "login", "credential",
                                 "unauthorized", "401", "forbidden", "403")):
        raise AppError(ErrorCode.LLM_AUTH_FAILED, "Authentication failed", status_code=401, detail=safe_detail) from error
    if any(kw in msg for kw in ("expired", "token")):
        raise AppError(ErrorCode.AUTH_EXPIRED, "Token expired or invalid", status_code=401, detail=safe_detail) from error
    if any(kw in msg for kw in ("permission", "access denied", "denied")):
        raise AppError(ErrorCode.ACCESS_DENIED, "Access denied", status_code=403, detail=safe_detail) from error

    if any(kw in msg for kw in ("connect", "refused", "unreachable",
                                 "resolve", "dns", "network", "socket")):
        raise AppError(ErrorCode.DB_CONNECTION_FAILED, "Connection failed", status_code=502, detail=safe_detail, retry=True) from error
    if "timeout" in msg or "timed out" in msg:
        raise AppError(ErrorCode.DB_CONNECTION_FAILED, "Connection timed out", status_code=504, detail=safe_detail, retry=True) from error

    if "required" in msg or "invalid" in msg or "missing" in msg:
        raise AppError(ErrorCode.INVALID_REQUEST, "Invalid parameters", status_code=400, detail=safe_detail) from error

    raise AppError(ErrorCode.CONNECTOR_ERROR, "An unexpected connector error occurred", status_code=500, detail=safe_detail) from error


def _sanitize_error(error: Exception) -> tuple[str, int]:
    """Legacy wrapper — prefer ``classify_and_raise_connector_error``."""
    from data_formulator.errors import AppError
    try:
        classify_and_raise_connector_error(error)
    except AppError as ae:
        return ae.message, ae.status_code
    return "An unexpected error occurred", 500


def _node_to_dict(node: CatalogNode) -> dict[str, Any]:
    return {
        "name": node.name,
        "node_type": node.node_type,
        "path": node.path,
        "metadata": node.metadata,
    }


def _hierarchy_dicts(levels: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{"key": l["key"], "label": l["label"]} for l in levels]


def _catalog_pagination_args(data: dict[str, Any]) -> tuple[int | None, int]:
    """Parse optional catalog pagination args from a request body."""
    raw_limit = data.get("limit")
    if raw_limit is None:
        return None, 0
    try:
        limit = int(raw_limit)
        offset = int(data.get("offset") or 0)
    except (TypeError, ValueError):
        return None, 0
    if limit <= 0:
        return None, 0
    return min(limit, _MAX_CATALOG_PAGE_SIZE), max(0, offset)


def _user_connector_key(identity: str, source_id: str) -> str:
    """Return the internal registry key for a user-owned connector."""
    return f"{_USER_CONNECTOR_PREFIX}{identity}::{source_id}"


def _is_user_connector_key(key: str) -> bool:
    return key.startswith(_USER_CONNECTOR_PREFIX)


def _public_connector_id(registry_key: str, connector: "DataConnector") -> str:
    """Return the public connector ID exposed to clients."""
    return connector._source_id


def _param_defs_by_name(loader_class: type[ExternalDataLoader]) -> dict[str, dict[str, Any]]:
    return {p.get("name", ""): p for p in loader_class.list_params()}


def _is_sensitive_or_auth_param(
    loader_class: type[ExternalDataLoader],
    name: str,
    *,
    include_auth_tier: bool = False,
) -> bool:
    """Return whether a loader parameter should not be exposed as pinned config."""
    param = _param_defs_by_name(loader_class).get(name, {})
    lower = name.lower()
    if param.get("sensitive") or param.get("type") == "password":
        return True
    if lower in SENSITIVE_PARAMS:
        return True
    if include_auth_tier and param.get("tier") == "auth":
        return True
    return False


def _connector_config_params(
    loader_class: type[ExternalDataLoader],
    params: dict[str, Any],
) -> dict[str, Any]:
    """Keep only non-sensitive, non-auth params in persisted connector config."""
    return {
        k: v for k, v in (params or {}).items()
        if not _is_sensitive_or_auth_param(loader_class, k, include_auth_tier=True)
    }


def _visible_connector_items(identity: str | None) -> list[tuple[str, "DataConnector", bool]]:
    """Return registry entries visible to the current identity.

    Admin connectors are global. User connectors are keyed by identity in the
    process registry. Raw non-admin entries are treated as legacy/test globals;
    newly created user connectors should use ``_user_connector_key``.
    """
    if identity:
        load_connectors(identity)

    result = []
    user_prefix = f"{_USER_CONNECTOR_PREFIX}{identity}::" if identity else None
    for key, connector in DATA_CONNECTORS.items():
        if key in _ADMIN_CONNECTOR_IDS:
            result.append((key, connector, True))
        elif user_prefix and key.startswith(user_prefix):
            result.append((key, connector, False))
        elif not _is_user_connector_key(key):
            result.append((key, connector, key in _ADMIN_CONNECTOR_IDS))
    return result


def _resolve_connector_with_key(data: dict[str, Any]) -> tuple[str, "DataConnector"]:
    """Look up a connector visible to the current request identity."""
    from data_formulator.errors import AppError, ErrorCode

    connector_id = data.get("connector_id")
    if not connector_id:
        raise AppError(ErrorCode.INVALID_REQUEST, "connector_id is required", status_code=400)

    try:
        identity = DataConnector._get_identity()
    except Exception as exc:
        raise AppError(ErrorCode.INVALID_REQUEST, "Identity is required", status_code=400) from exc

    # Admin/global connector IDs are public registry keys.
    if connector_id in _ADMIN_CONNECTOR_IDS and connector_id in DATA_CONNECTORS:
        return connector_id, DATA_CONNECTORS[connector_id]

    user_key = _user_connector_key(identity, connector_id)
    if user_key in DATA_CONNECTORS:
        return user_key, DATA_CONNECTORS[user_key]

    # Backward-compatible fallback for tests and pre-existing process-local
    # globals. API-created user connectors no longer use this path.
    legacy = DATA_CONNECTORS.get(connector_id)
    if legacy is not None and not _is_user_connector_key(connector_id):
        return connector_id, legacy

    raise AppError(ErrorCode.CONNECTOR_ERROR, "Connector not found", status_code=404)


# ---------------------------------------------------------------------------
# DataConnector
# ---------------------------------------------------------------------------

class DataConnector:
    """Generic lifecycle wrapper for an ExternalDataLoader.

    Provides connect / disconnect / status, catalog browsing, and
    data import / preview / refresh — all driven by the underlying
    loader's existing methods.

    Routes live on the shared ``connectors_bp`` blueprint; this class
    is a plain Python object (no per-instance blueprint).
    """

    def __init__(
        self,
        loader_class: type[ExternalDataLoader],
        source_id: str,
        display_name: str | None = None,
        default_params: dict[str, Any] | None = None,
        icon: str | None = None,
    ) -> None:
        self._loader_class = loader_class
        self._source_id = source_id
        self._display_name = display_name or source_id
        self._default_params = default_params or {}
        self._icon = icon or source_id

        # Per-identity loader instances: identity_id → ExternalDataLoader
        # In-process cache; cleared on disconnect.
        self._loaders: dict[str, ExternalDataLoader] = {}

    # -- Factory -----------------------------------------------------------

    @classmethod
    def from_loader(
        cls,
        loader_class: type[ExternalDataLoader],
        source_id: str,
        display_name: str | None = None,
        default_params: dict[str, Any] | None = None,
        icon: str | None = None,
    ) -> "DataConnector":
        return cls(
            loader_class=loader_class,
            source_id=source_id,
            display_name=display_name,
            default_params=default_params,
            icon=icon,
        )

    # -- Manifest / config interface ----------------------------------------

    def _manifest(self) -> dict[str, Any]:
        return {
            "id": self._source_id,
            "name": self._display_name,
            "icon": self._icon,
            "env_prefix": f"DF_{self._source_id.upper()}",
            "required_env": [],
            "auth_modes": [self._loader_class.auth_mode()],
            "capabilities": ["tables", "catalog", "refresh"],
        }

    # Common filter-tier param appended to every loader's form
    _TABLE_FILTER_PARAM = {
        "name": "table_filter",
        "type": "string",
        "required": False,
        "default": "",
        "tier": "filter",
        "description": "Filter table by keywords (e.g. 'sales')",
    }

    def get_frontend_config(self) -> dict[str, Any]:
        all_params = self._loader_class.list_params()
        form_fields: list[dict] = []
        pinned_params: dict[str, Any] = {}

        for param in all_params:
            name = param["name"]
            if name in self._default_params:
                if not _is_sensitive_or_auth_param(self._loader_class, name, include_auth_tier=True):
                    pinned_params[name] = self._default_params[name]
            else:
                form_fields.append(param)

        # Append common table_filter param
        form_fields.append(self._TABLE_FILTER_PARAM)

        full_hierarchy = self._loader_class.catalog_hierarchy()
        effective = [
            level for level in full_hierarchy
            if not self._default_params.get(level["key"])
        ]

        return {
            "source_id": self._source_id,
            "source_type": self._source_id,
            "name": self._display_name,
            "icon": self._icon,
            "params_form": form_fields,
            "pinned_params": pinned_params,
            "hierarchy": _hierarchy_dicts(full_hierarchy),
            "effective_hierarchy": _hierarchy_dicts(effective),
            "auth_instructions": self._loader_class.auth_instructions(),
            "auth_mode": self._loader_class.auth_mode(),
            "delegated_login": self._resolve_delegated_login(),
        }

    def _resolve_delegated_login(self) -> dict[str, Any] | None:
        """Resolve delegated login config, converting relative URLs to absolute."""
        raw = self._loader_class.delegated_login_config()
        if raw is None:
            return None
        login_url = raw.get("login_url", "")
        # Resolve relative URLs to the connector's API prefix
        if login_url and not login_url.startswith("http"):
            login_url = f"/api/connectors/{self._source_id}/{login_url}"
        # Only send safe fields to the frontend
        return {"login_url": login_url, "label": raw.get("label", "")}

    # -- Identity + Loader Management --------------------------------------

    @staticmethod
    def _get_identity() -> str:
        from data_formulator.auth.identity import get_identity_id
        return get_identity_id()

    @staticmethod
    def _get_vault():
        """Return the credential vault (or None if unavailable)."""
        from data_formulator.auth.vault import get_credential_vault
        return get_credential_vault()

    def _vault_store(self, identity: str, user_params: dict[str, Any]) -> bool:
        """Encrypt and persist user_params for this source. Returns True on success."""
        vault = self._get_vault()
        if vault is None:
            return False
        try:
            vault.store(identity, self._source_id, {
                "user_params": user_params,
                "source_id": self._source_id,
            })
            return True
        except Exception as exc:
            logger.warning("Failed to store credentials for %s/%s: %s",
                           identity[:16], self._source_id, exc)
            return False

    def _vault_retrieve(self, identity: str) -> dict[str, Any] | None:
        """Retrieve stored user_params from the vault. Returns None if absent."""
        vault = self._get_vault()
        if vault is None:
            return None
        try:
            data = vault.retrieve(identity, self._source_id)
            if data and "user_params" in data:
                return data["user_params"]
            return None
        except Exception as exc:
            logger.warning("Failed to retrieve credentials for %s/%s: %s",
                           identity[:16], self._source_id, exc)
            return None

    def _vault_delete(self, identity: str) -> None:
        """Delete stored credentials from the vault."""
        vault = self._get_vault()
        if vault is None:
            return
        try:
            vault.delete(identity, self._source_id)
        except Exception as exc:
            logger.warning("Failed to delete credentials for %s/%s: %s",
                           identity[:16], self._source_id, exc)

    def has_stored_credentials(self, identity: str) -> bool:
        """Check if the vault has credentials for this identity+source."""
        vault = self._get_vault()
        if vault is None:
            return False
        try:
            return self._source_id in vault.list_sources(identity)
        except Exception as e:
            logger.debug("Could not check stored credentials for %s", self._source_id, exc_info=e)
            return False

    def _get_loader(self, identity: str | None = None) -> ExternalDataLoader | None:
        identity = identity or self._get_identity()
        return self._loaders.get(identity)

    def _connect(self, user_params: dict[str, Any], persist: bool = True) -> ExternalDataLoader:
        """Instantiate a loader with merged params (default + user).

        Note: This only creates the loader and caches it in-memory.
        Vault persistence is handled separately by the caller after
        connection verification succeeds.
        """
        merged = {**self._default_params, **user_params}
        self._inject_credentials(merged)
        loader = self._loader_class(merged)
        identity = self._get_identity()
        self._loaders[identity] = loader
        return loader

    def _persist_credentials(self, user_params: dict[str, Any]) -> bool:
        """Store credentials in the vault for the current identity."""
        identity = self._get_identity()
        return self._vault_store(identity, user_params)

    def _delete_credentials(self) -> None:
        """Delete: clear in-memory loader AND vault credentials."""
        identity = self._get_identity()
        self._loaders.pop(identity, None)
        self._vault_delete(identity)

    def _try_auto_reconnect(self, identity: str) -> ExternalDataLoader | None:
        """Attempt to restore a connection from vault credentials.

        Returns the loader on success, or None (and cleans up stale vault
        entry) on failure.
        """
        stored_params = self._vault_retrieve(identity)
        if stored_params is None:
            # No vault creds — try SSO token exchange as last resort
            return self._try_sso_auto_connect(identity)
        try:
            merged = {**self._default_params, **stored_params}
            self._inject_credentials(merged)
            loader = self._loader_class(merged)
            if loader.test_connection():
                self._loaders[identity] = loader
                logger.info("Auto-reconnected '%s' for %s", self._source_id, identity[:16])
                return loader
            else:
                logger.info("Auto-reconnect test failed for '%s'/%s, clearing stale credentials",
                            self._source_id, identity[:16])
                self._vault_delete(identity)
                return None
        except Exception as exc:
            logger.warning("Auto-reconnect failed for '%s'/%s: %s",
                           self._source_id, identity[:16], exc)
            self._vault_delete(identity)
            return None

    def _inject_credentials(self, params: dict[str, Any]) -> None:
        """Inject the best available credentials via TokenStore.

        Falls back to the legacy SSO token injection when TokenStore
        is unavailable (e.g. outside a request context).
        """
        if params.get("access_token") or params.get("sso_access_token"):
            return

        config = (self._loader_class.auth_config()
                  if hasattr(self._loader_class, "auth_config") else None)
        mode = config.get("mode") if config else self._loader_class.auth_mode()

        if mode in ("credentials", "connection"):
            return

        try:
            from data_formulator.auth.token_store import TokenStore
            token_store = TokenStore()
            access = token_store.get_access(self._source_id)
            if access:
                if isinstance(access, dict):
                    params.update(access)
                else:
                    params["access_token"] = access
                return
        except Exception as exc:
            logger.debug("TokenStore lookup failed for %s: %s",
                         self._source_id, exc)

        # Legacy fallback: inject raw SSO token for exchange
        try:
            from data_formulator.auth.identity import get_sso_token
            sso_token = get_sso_token()
            if sso_token:
                params["sso_access_token"] = sso_token
        except Exception as e:
            logger.debug("SSO token injection failed for %s",
                         self._source_id, exc_info=e)

    # Backward-compatible alias
    _inject_sso_token = _inject_credentials

    def _try_sso_auto_connect(self, identity: str) -> ExternalDataLoader | None:
        """Try to auto-connect using TokenStore or the current SSO token.

        Only applies to token/sso_exchange-mode loaders when no vault
        credentials exist.
        """
        config = (self._loader_class.auth_config()
                  if hasattr(self._loader_class, "auth_config") else None)
        mode = config.get("mode") if config else self._loader_class.auth_mode()

        if mode not in ("token", "sso_exchange", "delegated"):
            return None

        merged = {**self._default_params}
        self._inject_credentials(merged)

        if not (merged.get("access_token") or merged.get("sso_access_token")):
            return None
        try:
            loader = self._loader_class(merged)
            if loader.test_connection():
                self._loaders[identity] = loader
                logger.info("Auto-connect succeeded for '%s'/%s",
                            self._source_id, identity[:16])
                return loader
        except Exception as exc:
            logger.debug("Auto-connect failed for '%s': %s",
                         self._source_id, exc)
        return None

    def _require_loader(self) -> ExternalDataLoader:
        identity = self._get_identity()
        loader = self._loaders.get(identity)
        if loader is not None:
            return loader
        # Try auto-reconnect from vault
        loader = self._try_auto_reconnect(identity)
        if loader is not None:
            return loader
        raise ValueError("Not connected. Please connect first.")


# ---------------------------------------------------------------------------
# Shared action routes — connector_id in JSON body
# ---------------------------------------------------------------------------

def _resolve_connector(data: dict[str, Any]) -> DataConnector:
    """Look up a DataConnector from the request body's ``connector_id``.

    Returns the connector or raises ``AppError``.
    """
    _, connector = _resolve_connector_with_key(data)
    return connector


def _parse_source_table(raw: Any) -> tuple[str, str]:
    """Normalise the ``source_table`` value from a request body.

    Accepts two shapes:
    - **structured** ``{"id": "42", "name": "orders_fact"}`` — id is the
      opaque identifier the loader needs, name is human-readable.
    - **plain string** ``"public.users"`` — used as both id and name
      (backward-compatible for simple DB loaders).

    Returns ``(source_id, source_name)``.
    """
    if isinstance(raw, dict):
        sid = str(raw.get("id") or raw.get("name") or "")
        sname = str(raw.get("name") or raw.get("id") or "")
        return sid, sname
    return str(raw), str(raw)


# ---------------------------------------------------------------------------
# Global connector management routes
# ---------------------------------------------------------------------------

connectors_bp = Blueprint("connectors_global", __name__)


@connectors_bp.route("/api/data-loaders", methods=["GET"])
def list_data_loaders():
    """Return available loader types + their param definitions.

    This is the discovery endpoint — tells the frontend what kinds of
    connectors can be created.
    """
    from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS
    from data_formulator.auth.identity import is_local_mode

    loaders = []
    for key, loader_class in DATA_LOADERS.items():
        # local_folder has its own dedicated card — hide from Add Connection list
        if key == "local_folder":
            continue
        params = loader_class.list_params()
        # Append common table_filter param (same as DataConnector.get_frontend_config)
        params.append(DataConnector._TABLE_FILTER_PARAM)
        loaders.append({
            "type": key,
            "name": key.replace("_", " ").title(),
            "params": params,
            "hierarchy": _hierarchy_dicts(loader_class.catalog_hierarchy()),
            "auth_mode": loader_class.auth_mode(),
            "auth_instructions": loader_class.auth_instructions(),
            "delegated_login": loader_class.delegated_login_config(),
        })

    disabled = {
        name: {"install_hint": hint}
        for name, hint in DISABLED_LOADERS.items()
    }

    return jsonify({"loaders": loaders, "disabled": disabled})


@connectors_bp.route("/api/local/pick-directory", methods=["POST"])
def pick_local_directory():
    """Open a native OS directory picker and return the selected path.

    Only available in local deployment mode (backend bound to localhost).

    Strategy per platform (each uses tools that ship with the OS):

    - **macOS**: ``osascript`` (AppleScript) — ships with every Mac.
    - **Windows**: PowerShell ``System.Windows.Forms.FolderBrowserDialog``
      — built into Windows 10+.
    - **Linux**: tries in order: ``zenity`` (GNOME), ``kdialog`` (KDE),
      ``tkinter`` (Python stdlib, if compiled with Tk).

    If no dialog tool is available (headless server, minimal container),
    returns ``501`` so the frontend can fall back to a text input.
    """
    import platform
    import shutil
    import subprocess

    from data_formulator.auth.identity import is_local_mode

    if not is_local_mode():
        return jsonify({"error": "Not available in server mode"})

    folder: str | None = None
    system = platform.system()

    try:
        if system == "Darwin":
            # macOS: use osascript (AppleScript) — always available
            script = (
                'tell application "System Events"\n'
                '  activate\n'
                '  set theFolder to choose folder with prompt "Select data folder"\n'
                '  return POSIX path of theFolder\n'
                'end tell'
            )
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                folder = result.stdout.strip().rstrip("/")
            # returncode != 0 means user cancelled

        elif system == "Windows":
            # Windows: PowerShell folder browser dialog
            ps_script = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$f.Description = 'Select data folder'; "
                "if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }"
            )
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_script],
                capture_output=True, text=True, timeout=120,
            )
            if result.returncode == 0 and result.stdout.strip():
                folder = result.stdout.strip()

        else:
            # Linux: try zenity (GNOME) → kdialog (KDE) → tkinter
            if shutil.which("zenity"):
                result = subprocess.run(
                    ["zenity", "--file-selection", "--directory",
                     "--title=Select data folder"],
                    capture_output=True, text=True, timeout=120,
                )
                if result.returncode == 0 and result.stdout.strip():
                    folder = result.stdout.strip()
            elif shutil.which("kdialog"):
                result = subprocess.run(
                    ["kdialog", "--getexistingdirectory", ".",
                     "--title", "Select data folder"],
                    capture_output=True, text=True, timeout=120,
                )
                if result.returncode == 0 and result.stdout.strip():
                    folder = result.stdout.strip()
            else:
                try:
                    import tkinter as tk
                    from tkinter import filedialog
                    root = tk.Tk()
                    root.withdraw()
                    root.attributes("-topmost", True)
                    folder = filedialog.askdirectory(
                        title="Select data folder") or None
                    root.destroy()
                except (ImportError, Exception):
                    return jsonify({
                        "error": "No dialog tool available. "
                                 "Install zenity, kdialog, or python3-tk.",
                        "path": None,
                        "fallback": "text_input",
                    })

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Dialog timed out", "path": None})
    except Exception as exc:
        logger.warning("Failed to open directory picker: %s", exc)
        return jsonify({
            "error": "Failed to open directory picker", "path": None, "fallback": "text_input",
        })

    if not folder:
        return jsonify({"path": None})  # user cancelled
    return jsonify({"path": folder})


@connectors_bp.route("/api/connectors", methods=["GET"])
def list_connectors():
    """List all registered connector instances (admin + user) with connection status."""
    from data_formulator.auth.identity import get_identity_id, get_sso_token

    try:
        identity = get_identity_id()
    except Exception as e:
        logger.debug("Identity unavailable for connector list", exc_info=e)
        identity = None

    sso_token = None
    try:
        sso_token = get_sso_token() if identity else None
    except Exception as e:
        logger.debug("SSO token unavailable for connector list", exc_info=e)

    result = []
    for registry_key, connector, is_admin in _visible_connector_items(identity):
        connected = False
        if identity:
            connected = (
                connector._get_loader(identity) is not None
                or connector.has_stored_credentials(identity)
            )
        # SSO auto-connect: token-mode loader + user has SSO token + URL is pinned
        sso_auto = (
            not connected
            and sso_token is not None
            and connector._loader_class.auth_mode() == "token"
            and bool(connector._default_params.get("url"))
        )
        cfg = connector.get_frontend_config()
        public_id = _public_connector_id(registry_key, connector)
        result.append({
            "id": public_id,
            "source": "admin" if is_admin else "user",
            "deletable": not is_admin,
            "source_type": connector._loader_class.__name__,
            "display_name": connector._display_name,
            "icon": connector._icon,
            "connected": connected,
            "sso_auto_connect": sso_auto,
            "params_form": cfg["params_form"],
            "pinned_params": cfg["pinned_params"],
            "hierarchy": cfg["hierarchy"],
            "effective_hierarchy": cfg["effective_hierarchy"],
            "auth_mode": cfg["auth_mode"],
            "delegated_login": cfg.get("delegated_login"),
        })

    return jsonify({"connectors": result})


@connectors_bp.route("/api/connectors", methods=["POST"])
def create_connector():
    """Create a new user connector instance from a loader type.

    Request body::

        {
            "loader_type": "mysql",
            "display_name": "MySQL · prod",
            "params": {"host": "...", "port": "3306", ...},
            "icon": "mysql",
            "persist": true
        }

    Persists to ``DATA_FORMULATOR_HOME/users/<identity>/connectors.yaml``.
    """
    from data_formulator.data_loader import DATA_LOADERS

    data = request.get_json() or {}
    loader_type = data.get("loader_type")
    if not loader_type:
        return jsonify({"status": "error", "message": "loader_type is required"})

    loader_class = DATA_LOADERS.get(loader_type)
    if not loader_class:
        return jsonify({"status": "error", "message": f"Unknown loader type: {loader_type}"})

    display_name = data.get("display_name", loader_type.replace("_", " ").title())
    icon = data.get("icon", loader_type)
    raw_params = data.get("params", {})
    default_params = _connector_config_params(loader_class, raw_params)

    try:
        identity = DataConnector._get_identity()
    except Exception as e:
        logger.warning("Cannot create connector without identity: %s", type(e).__name__)
        return jsonify({"status": "error", "message": "Identity is required"})

    # Generate instance ID: loader_type:slug
    import re
    slug = re.sub(r'[^a-z0-9\-]', '-', display_name.lower()).strip('-')
    slug = re.sub(r'-+', '-', slug)
    instance_id = f"{loader_type}:{slug}" if slug else loader_type

    # Avoid collision with existing admin connectors and this identity's connectors.
    def _connector_exists(candidate: str) -> bool:
        return (
            candidate in _ADMIN_CONNECTOR_IDS
            or _user_connector_key(identity, candidate) in DATA_CONNECTORS
            or (candidate in DATA_CONNECTORS and not _is_user_connector_key(candidate))
        )

    if _connector_exists(instance_id):
        for i in range(2, 100):
            candidate = f"{instance_id}-{i}"
            if not _connector_exists(candidate):
                instance_id = candidate
                display_name = f"{display_name} ({i})"
                break
        else:
            return jsonify({"status": "error", "message": "Too many connectors with this name"})

    connector = DataConnector.from_loader(
        loader_class,
        source_id=instance_id,
        display_name=display_name,
        default_params=default_params,
        icon=icon,
    )
    registry_key = _user_connector_key(identity, instance_id)
    DATA_CONNECTORS[registry_key] = connector

    # Persist to user connectors.yaml
    try:
        _persist_user_connector(identity, SourceSpec(
            source_id=instance_id,
            loader_type=loader_type,
            display_name=display_name,
            default_params=default_params,
            icon=icon,
            source="user",
        ))
    except Exception as e:
        logger.warning("Failed to persist connector '%s' to user config: %s", instance_id, e)
        persist_warning = "Connector created but could not be saved to config"
    else:
        persist_warning = None

    # Auto-connect if params were provided
    result_data: dict[str, Any] = {
        "status": "created",
        "id": instance_id,
        "display_name": display_name,
        "source": "user",
        "deletable": True,
    }

    connect_params = data.get("connect_params", raw_params)
    if connect_params:
        try:
            persist = data.get("persist", True)
            loader = connector._connect(connect_params)
            if loader.test_connection():
                if persist:
                    connector._persist_credentials(connect_params)
                result_data["connected"] = True
            else:
                identity_c = connector._get_identity()
                connector._loaders.pop(identity_c, None)
                result_data["connected"] = False
                result_data["connect_error"] = "Connection test failed"
        except Exception as e:
            try:
                identity_c = connector._get_identity()
                connector._loaders.pop(identity_c, None)
            except Exception:
                pass
            result_data["connected"] = False
            safe_msg, _ = _sanitize_error(e)
            result_data["connect_error"] = safe_msg

    if persist_warning:
        result_data["persist_warning"] = persist_warning

    logger.info("Created user connector '%s' (type=%s)", instance_id, loader_type)
    return jsonify(result_data), 201


def _persist_user_connector(identity: str, spec: "SourceSpec") -> None:
    """Add a connector spec to the user's connectors.yaml (append, no duplicates)."""
    existing = _load_user_specs(identity)
    # Remove any existing entry with same ID
    existing = [s for s in existing if s.source_id != spec.source_id]
    existing.append(spec)
    _save_user_connectors(identity, existing)


def _remove_user_connector(identity: str, connector_id: str) -> None:
    """Remove a connector spec from the user's connectors.yaml."""
    existing = _load_user_specs(identity)
    existing = [s for s in existing if s.source_id != connector_id]
    _save_user_connectors(identity, existing)


@connectors_bp.route("/api/connectors/<path:connector_id>", methods=["DELETE"])
def delete_connector(connector_id: str):
    """Delete a **user** connector instance, clear vault credentials, and remove from config.

    Admin connectors cannot be deleted (returns 403).
    """

    if connector_id in _ADMIN_CONNECTOR_IDS:
        return jsonify({"status": "error", "message": "Admin connectors cannot be deleted"})

    try:
        registry_key, connector = _resolve_connector_with_key({"connector_id": connector_id})
    except Exception:
        return jsonify({"status": "error", "message": f"Unknown connector: {connector_id}"})

    # Full cleanup: in-memory loader + vault credentials
    try:
        connector._delete_credentials()
    except Exception as e:
        logger.warning("Failed to delete credentials for connector '%s'", connector_id, exc_info=e)

    # Remove from user connectors.yaml
    try:
        identity = DataConnector._get_identity()
        _remove_user_connector(identity, connector_id)
    except Exception as e:
        logger.warning("Failed to remove connector '%s' from user config: %s", connector_id, e)
    DATA_CONNECTORS.pop(registry_key, None)

    logger.info("Deleted user connector '%s'", connector_id)
    return jsonify({"status": "deleted", "id": connector_id})


# ---------------------------------------------------------------------------
# Action routes (shared — connector_id in JSON body)
# ---------------------------------------------------------------------------

@connectors_bp.route("/api/connectors/connect", methods=["POST"])
def connector_connect():
    """(Re)connect / authenticate a connector instance.

    Accepts ``connector_id`` plus two modes:

    **Credential mode** (default)::

        {"connector_id": "mysql:prod", "params": {...}, "persist": true}

    **Token mode** (delegated/SSO)::

        {"connector_id": "...", "mode": "token", "access_token": "eyJ...",
         "refresh_token": "...", "user": {...}, "params": {...}, "persist": true}
    """
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        mode = data.get("mode", "credentials")
        persist = data.get("persist", True)

        if mode == "token":
            access_token = data.get("access_token")
            if not access_token:
                return jsonify({"status": "error", "message": "Missing access_token"})
            extra_params = data.get("params", {})
            user_params = {
                **extra_params,
                "access_token": access_token,
                "refresh_token": data.get("refresh_token", ""),
            }
        else:
            user_params = data.get("params", {})

        loader = source._connect(user_params)

        if not loader.test_connection():
            identity = source._get_identity()
            source._loaders.pop(identity, None)
            return jsonify({"status": "error", "message": "Connection test failed"})

        persisted = False
        if persist:
            persisted = source._persist_credentials(user_params)
        else:
            identity = source._get_identity()
            source._vault_delete(identity)

        safe = loader.get_safe_params()
        result = {
            "status": "connected",
            "persisted": persisted,
            "params": safe,
            "hierarchy": _hierarchy_dicts(loader.catalog_hierarchy()),
            "effective_hierarchy": _hierarchy_dicts(loader.effective_hierarchy()),
            "pinned_scope": loader.pinned_scope(),
        }
        if mode == "token" and data.get("user"):
            result["user"] = data["user"]
        return jsonify(result)
    except Exception as e:
        try:
            identity = source._get_identity()
            source._loaders.pop(identity, None)
        except Exception:
            pass
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/get-status", methods=["POST"])
def connector_get_status():
    """Check connection status (no side effects — no auto-reconnect)."""
    data = request.get_json() or {}
    source = _resolve_connector(data)

    identity = source._get_identity()
    loader = source._get_loader(identity)
    if loader is None:
        has_stored = source.has_stored_credentials(identity)
        sso_available = False
        try:
            from data_formulator.auth.identity import get_sso_token
            sso_available = (
                source._loader_class.auth_mode() == "token"
                and get_sso_token() is not None
            )
        except Exception as e:
            logger.debug("SSO availability check failed", exc_info=e)
        return jsonify({
            "connected": False,
            "has_stored_credentials": has_stored,
            "sso_available": sso_available,
            "params_form": source.get_frontend_config()["params_form"],
        })
    try:
        alive = loader.test_connection()
    except Exception as e:
        logger.warning("Connection test failed for connector", exc_info=e)
        alive = False
    if not alive:
        source._loaders.pop(identity, None)
        return jsonify({
            "connected": False,
            "has_stored_credentials": source.has_stored_credentials(identity),
            "params_form": source.get_frontend_config()["params_form"],
        })
    return jsonify({
        "connected": True,
        "persisted": source._get_vault() is not None,
        "params": loader.get_safe_params(),
        "hierarchy": _hierarchy_dicts(loader.catalog_hierarchy()),
        "effective_hierarchy": _hierarchy_dicts(loader.effective_hierarchy()),
        "pinned_scope": loader.pinned_scope(),
    })


@connectors_bp.route("/api/connectors/get-catalog", methods=["POST"])
def connector_get_catalog():
    """Browse a catalog node (merged ls + metadata)."""
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()
        path = data.get("path", [])
        name_filter = data.get("filter")
        limit, offset = _catalog_pagination_args(data)

        if limit is None:
            nodes = loader.ls(path=path, filter=name_filter)
            has_more = False
            next_offset = None
        else:
            page_size = limit + 1
            if "limit" in inspect.signature(loader.ls).parameters:
                raw_nodes = loader.ls(path=path, filter=name_filter, limit=page_size, offset=offset)
                nodes = raw_nodes[:limit]
                has_more = len(raw_nodes) > limit
            else:
                raw_nodes = loader.ls(path=path, filter=name_filter)
                nodes = raw_nodes[offset:offset + limit]
                has_more = len(raw_nodes) > offset + limit
            next_offset = offset + limit if has_more else None
        result: dict[str, Any] = {
            "hierarchy": _hierarchy_dicts(loader.catalog_hierarchy()),
            "effective_hierarchy": _hierarchy_dicts(loader.effective_hierarchy()),
            "path": path,
            "nodes": [_node_to_dict(n) for n in nodes],
            "has_more": has_more,
            "next_offset": next_offset,
        }
        if path:
            try:
                metadata = loader.get_metadata(path)
                result["metadata"] = metadata
            except Exception as e:
                logger.debug("Metadata fetch failed for path %s", path, exc_info=e)
        return jsonify(result)
    except Exception as e:
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/get-catalog-tree", methods=["POST"])
def connector_get_catalog_tree():
    """Build nested tree from ``list_tables()`` with full metadata."""
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()
        name_filter = data.get("filter")

        result = loader.list_tables_tree(table_filter=name_filter)
        return jsonify({
            "hierarchy": _hierarchy_dicts(result["hierarchy"]),
            "effective_hierarchy": _hierarchy_dicts(result["effective_hierarchy"]),
            "tree": result["tree"],
        })
    except Exception as e:
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/import-data", methods=["POST"])
def connector_import_data():
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()

        raw_source = data.get("source_table")
        if not raw_source:
            return jsonify({"status": "error", "message": "source_table is required"})

        source_id, source_name = _parse_source_table(raw_source)
        table_name = data.get("table_name") or source_name
        import_options = data.get("import_options", {})

        from data_formulator.auth.identity import get_identity_id
        from data_formulator.workspace_factory import get_workspace
        from data_formulator.datalake.parquet_utils import sanitize_table_name

        workspace = get_workspace(get_identity_id())

        safe_name = sanitize_table_name(table_name)

        meta = loader.ingest_to_workspace(
            workspace=workspace,
            table_name=safe_name,
            source_table=source_id,
            import_options=import_options or None,
        )
        return jsonify({
            "status": "success",
            "table_name": meta.name,
            "row_count": meta.row_count,
            "refreshable": True,
        })
    except Exception as e:
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/refresh-data", methods=["POST"])
def connector_refresh_data():
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()
        table_name = data.get("table_name")
        if not table_name:
            return jsonify({"status": "error", "message": "table_name is required"})

        from data_formulator.auth.identity import get_identity_id
        from data_formulator.workspace_factory import get_workspace

        workspace = get_workspace(get_identity_id())
        meta = workspace.get_table_metadata(table_name)
        if meta is None or not meta.source_table:
            return jsonify({"status": "error", "message": f"No refreshable source for '{table_name}'"})

        arrow_table = loader.fetch_data_as_arrow(
            source_table=meta.source_table,
            import_options=meta.import_options,
        )
        new_meta, data_changed = workspace.refresh_parquet_from_arrow(table_name, arrow_table)
        return jsonify({
            "status": "success",
            "table_name": table_name,
            "row_count": new_meta.row_count,
            "data_changed": data_changed,
        })
    except Exception as e:
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/preview-data", methods=["POST"])
def connector_preview_data():
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()
        raw_source = data.get("source_table")
        if not raw_source:
            return jsonify({"status": "error", "message": "source_table is required"})

        source_id, _source_name = _parse_source_table(raw_source)

        import_options = data.get("import_options", {})
        if not import_options:
            size = data.get("limit", 10)
            import_options = {"size": size}

        arrow_table = loader.fetch_data_as_arrow(
            source_table=source_id,
            import_options=import_options,
        )
        df = arrow_table.to_pandas()
        rows = _json.loads(df.to_json(orient="records", date_format="iso"))
        columns = [{"name": col, "type": str(df[col].dtype)} for col in df.columns]

        # Enrich columns with source-level types from loader metadata.
        # Source types (e.g. "timestamp", "varchar", "boolean") are far more
        # reliable for UI widget selection than pandas dtypes ("object", "int64").
        try:
            meta = loader.get_column_types(source_id)
            if not meta:
                meta = {}
            source_cols = {c["name"]: c for c in meta.get("columns", [])}
            if source_cols:
                for col_info in columns:
                    src = source_cols.get(col_info["name"])
                    if src:
                        col_info["source_type"] = src.get("type", "")
                        if src.get("is_dttm"):
                            col_info["source_type"] = "TEMPORAL"
        except Exception:
            pass  # source type enrichment is best-effort

        # Get actual total row count (some loaders store it before slicing)
        total_row_count = getattr(loader, '_last_total_rows', None) or len(rows)

        return jsonify({
            "status": "success",
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "total_row_count": total_row_count,
        })
    except Exception as e:
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/column-values", methods=["POST"])
def connector_column_values():
    """Return distinct values for a dataset column (smart filter support)."""
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()
        raw_source = data.get("source_table")
        if not raw_source:
            return jsonify({"status": "error", "message": "source_table is required"})
        source_id, _source_name = _parse_source_table(raw_source)

        column_name = (data.get("column_name") or "").strip()
        if not column_name:
            return jsonify({"status": "error", "message": "column_name is required"})

        keyword = (data.get("keyword") or "").strip()
        limit = int(data.get("limit", 50))
        offset = int(data.get("offset", 0))

        result = loader.get_column_values(
            source_table=source_id,
            column_name=column_name,
            keyword=keyword,
            limit=limit,
            offset=offset,
        )
        return jsonify({"status": "ok", **result})
    except Exception as e:
        classify_and_raise_connector_error(e)


@connectors_bp.route("/api/connectors/import-group", methods=["POST"])
def connector_import_group():
    """Import all tables from a table_group with shared filters."""
    data = request.get_json() or {}
    source = _resolve_connector(data)

    try:
        loader = source._require_loader()

        tables = data.get("tables")
        if not tables or not isinstance(tables, list):
            return jsonify({"status": "error", "message": "tables list is required"})

        row_limit = data.get("row_limit", -1)
        source_filters = data.get("source_filters", [])
        group_name = data.get("group_name", "")

        from data_formulator.auth.identity import get_identity_id
        from data_formulator.workspace_factory import get_workspace
        from data_formulator.datalake.parquet_utils import sanitize_table_name

        workspace = get_workspace(get_identity_id())
        results = []

        for table_entry in tables:
            ds_id = table_entry.get("dataset_id")
            ds_name = table_entry.get("name", f"dataset_{ds_id}")
            if not ds_id:
                continue

            table_filters = [
                f for f in source_filters
                if not f.get("applies_to") or ds_id in f.get("applies_to", [])
            ]

            import_options: dict = {}
            if row_limit > 0:
                import_options["size"] = row_limit
            if table_filters:
                import_options["source_filters"] = table_filters

            source_table = str(ds_id)
            table_name = f"{group_name} / {ds_name}" if group_name else ds_name
            safe_name = sanitize_table_name(table_name)

            try:
                meta = loader.ingest_to_workspace(
                    workspace=workspace,
                    table_name=safe_name,
                    source_table=source_table,
                    import_options=import_options or None,
                )
                results.append({
                    "status": "success",
                    "dataset_id": ds_id,
                    "table_name": meta.name,
                    "row_count": meta.row_count,
                })
            except Exception as e:
                logger.warning("import-group: failed to load dataset %s: %s", ds_id, e)
                results.append({
                    "status": "error",
                    "dataset_id": ds_id,
                    "table_name": ds_name,
                    "message": sanitize_error_message(str(e)),
                })

        return jsonify({
            "status": "success",
            "results": results,
        })
    except Exception as e:
        classify_and_raise_connector_error(e)



# ---------------------------------------------------------------------------
# Configuration loading — connectors.yaml (admin + user)
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class SourceSpec:
    """A single connector entry from config (YAML or env vars)."""
    source_id: str
    loader_type: str          # registry key in DATA_LOADERS (e.g. "mysql")
    display_name: str
    default_params: dict[str, Any] = dataclasses.field(default_factory=dict)
    icon: str = ""
    auto_connect: bool = False
    source: str = "admin"     # "admin" or "user"


def _resolve_env_refs(params: dict[str, Any]) -> dict[str, Any]:
    """Resolve ``${ENV_VAR}`` references in param values."""
    import os
    resolved = {}
    for k, v in params.items():
        if isinstance(v, str) and v.startswith("${") and v.endswith("}"):
            env_name = v[2:-1]
            resolved[k] = os.environ.get(env_name, "")
        else:
            resolved[k] = v
    return resolved


def _get_df_home() -> Path:
    """Return DATA_FORMULATOR_HOME as a Path."""
    from data_formulator.datalake.workspace import get_data_formulator_home
    return get_data_formulator_home()


def _load_connectors_yaml(path: "Path") -> list[dict]:
    """Load a connectors.yaml file and return the list of connector entries."""
    if not path.is_file():
        return []
    try:
        import yaml
        with open(path) as f:
            data = yaml.safe_load(f) or {}
        entries = data.get("connectors", [])
        if not isinstance(entries, list):
            logger.warning("connectors.yaml at %s: 'connectors' must be a list", path)
            return []
        logger.info("Loaded %d connector(s) from %s", len(entries), path)
        return entries
    except Exception as e:
        logger.warning("Failed to parse %s: %s", path, e)
        return []


def _save_user_connectors(identity: str, specs: list[SourceSpec]) -> None:
    """Write user-created connectors to DATA_FORMULATOR_HOME/users/<identity>/connectors.yaml."""
    from data_formulator.datalake.workspace import get_user_home
    user_dir = get_user_home(identity)
    user_dir.mkdir(parents=True, exist_ok=True)
    path = user_dir / "connectors.yaml"

    entries = []
    for s in specs:
        entry: dict[str, Any] = {
            "id": s.source_id,
            "type": s.loader_type,
            "name": s.display_name,
        }
        if s.default_params:
            entry["params"] = s.default_params
        if s.icon and s.icon != s.loader_type:
            entry["icon"] = s.icon
        entries.append(entry)

    try:
        import yaml
        with open(path, "w") as f:
            yaml.safe_dump({"connectors": entries}, f, default_flow_style=False, sort_keys=False)
        logger.info("Saved %d user connector(s) to %s", len(entries), path)
    except Exception as e:
        logger.warning("Failed to write %s: %s", path, e)


def _load_admin_specs() -> list[SourceSpec]:
    """Load admin connectors from DATA_FORMULATOR_HOME/connectors.yaml + env vars."""
    import os

    specs: list[SourceSpec] = []

    # 1. Env vars (DF_SOURCES__<id>__<key>=<value>) — highest priority
    prefix = "DF_SOURCES__"
    raw: dict[str, dict[str, str]] = {}
    for env_key, env_val in os.environ.items():
        # Windows env vars are case-insensitive; normalise for consistent IDs.
        if not env_key.upper().startswith(prefix):
            continue
        rest = env_key[len(prefix):]
        parts = rest.split("__", 1)
        if len(parts) != 2:
            continue
        instance_id, field = parts[0].lower(), parts[1].lower()
        raw.setdefault(instance_id, {})[field] = env_val

    for instance_id, fields in raw.items():
        loader_type = fields.pop("type", "")
        if not loader_type:
            logger.warning("DF_SOURCES__%s has no 'type' field, skipping", instance_id)
            continue
        name = fields.pop("name", loader_type.replace("_", " ").title())
        icon = fields.pop("icon", "")
        params: dict[str, str] = {}
        other: dict[str, str] = {}
        for k, v in fields.items():
            if k.startswith("params__"):
                params[k[len("params__"):]] = v
            else:
                other[k] = v
        params.update(other)
        specs.append(SourceSpec(
            source_id=instance_id,
            loader_type=loader_type,
            display_name=name,
            default_params=params,
            icon=icon,
            source="admin",
        ))

    env_ids = {s.source_id for s in specs}

    # 1b. PLG_SUPERSET_URL shortcut — auto-register Superset when set
    superset_url = os.environ.get("PLG_SUPERSET_URL", "").strip()
    if superset_url and "superset" not in env_ids:
        specs.append(SourceSpec(
            source_id="superset",
            loader_type="superset",
            display_name="Superset",
            default_params={"url": superset_url.rstrip("/")},
            icon="superset",
            source="admin",
        ))
        env_ids.add("superset")

    # 2. connectors.yaml in DATA_FORMULATOR_HOME
    try:
        admin_path = _get_df_home() / "connectors.yaml"
    except Exception as e:
        logger.debug("Could not resolve DATA_FORMULATOR_HOME", exc_info=e)
        admin_path = Path("__nonexistent__")

    for i, entry in enumerate(_load_connectors_yaml(admin_path)):
        loader_type = entry.get("type", "")
        if not loader_type:
            continue
        sid = entry.get("id") or (f"{loader_type}_{i}" if i > 0 else loader_type)
        if sid in env_ids:
            continue  # env var overrides
        specs.append(SourceSpec(
            source_id=sid,
            loader_type=loader_type,
            display_name=entry.get("name", loader_type.replace("_", " ").title()),
            default_params=_resolve_env_refs(entry.get("params", {})),
            icon=entry.get("icon", ""),
            auto_connect=entry.get("auto_connect", False),
            source="admin",
        ))

    return specs


def _load_user_specs(identity: str) -> list[SourceSpec]:
    """Load user connectors from DATA_FORMULATOR_HOME/users/<identity>/connectors.yaml."""
    try:
        from data_formulator.datalake.workspace import get_user_home
        user_path = get_user_home(identity) / "connectors.yaml"
    except Exception as e:
        logger.debug("Could not resolve user home for %s", identity[:16], exc_info=e)
        return []

    specs: list[SourceSpec] = []
    for i, entry in enumerate(_load_connectors_yaml(user_path)):
        loader_type = entry.get("type", "")
        if not loader_type:
            continue
        sid = entry.get("id") or (f"{loader_type}_{i}" if i > 0 else loader_type)
        specs.append(SourceSpec(
            source_id=sid,
            loader_type=loader_type,
            display_name=entry.get("name", loader_type.replace("_", " ").title()),
            default_params=_resolve_env_refs(entry.get("params", {})),
            icon=entry.get("icon", ""),
            source="user",
        ))
    return specs


# Track which connector IDs came from admin config (immutable by users).
_ADMIN_CONNECTOR_IDS: set[str] = set()

# Track identities whose user connectors have been loaded.
_LOADED_USER_IDENTITIES: set[str] = set()


def load_connectors(identity: str | None = None) -> None:
    """Ensure DATA_CONNECTORS contains admin + user connectors for *identity*.

    Admin connectors are loaded at startup by :func:`register_data_connectors`.
    Calling this with an identity lazily adds the user's connectors on first
    request.  Subsequent calls for the same identity are no-ops.
    """
    from data_formulator.data_loader import DATA_LOADERS

    if not identity or identity in _LOADED_USER_IDENTITIES:
        return

    _LOADED_USER_IDENTITIES.add(identity)

    user_specs = _load_user_specs(identity)
    for spec in user_specs:
        if spec.source_id in _ADMIN_CONNECTOR_IDS:
            continue  # admin connector takes precedence
        registry_key = _user_connector_key(identity, spec.source_id)
        if registry_key in DATA_CONNECTORS:
            continue
        loader_class = DATA_LOADERS.get(spec.loader_type)
        if not loader_class:
            continue
        source = DataConnector.from_loader(
            loader_class,
            source_id=spec.source_id,
            display_name=spec.display_name,
            default_params=spec.default_params,
            icon=spec.icon or spec.loader_type,
        )
        DATA_CONNECTORS[registry_key] = source
        logger.info("Loaded user connector '%s' (type=%s)", spec.source_id, spec.loader_type)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_data_connectors(app: Flask) -> None:
    """Register the global connectors blueprint + admin-provisioned connectors.

    Called from ``app.py`` during startup.

    - Registers ``connectors_bp`` with all shared routes.
    - Loads admin connectors from ``DATA_FORMULATOR_HOME/connectors.yaml``
      and ``DF_SOURCES__*`` env vars.
    - User connectors are loaded lazily on first request (need identity).
    """
    from data_formulator.data_loader import DATA_LOADERS, DISABLED_LOADERS

    # 1. Register the global management blueprint
    app.register_blueprint(connectors_bp)

    # 2. Load admin connectors
    admin_specs = _load_admin_specs()

    for spec in admin_specs:
        loader_class = DATA_LOADERS.get(spec.loader_type)
        if not loader_class:
            if spec.loader_type in DISABLED_LOADERS:
                logger.info(
                    "Source '%s' (type=%s) not available: %s",
                    spec.source_id, spec.loader_type, DISABLED_LOADERS[spec.loader_type],
                )
            else:
                logger.warning("Unknown source type '%s' for '%s'", spec.loader_type, spec.source_id)
            continue

        source = DataConnector.from_loader(
            loader_class,
            source_id=spec.source_id,
            display_name=spec.display_name,
            default_params=spec.default_params,
            icon=spec.icon or spec.loader_type,
        )
        DATA_CONNECTORS[spec.source_id] = source
        _ADMIN_CONNECTOR_IDS.add(spec.source_id)
        logger.info(
            "Registered admin connector '%s' (type=%s%s)",
            spec.source_id,
            spec.loader_type,
            f", pinned={list(spec.default_params.keys())}" if spec.default_params else "",
        )

    for key, reason in DISABLED_LOADERS.items():
        if key not in DATA_CONNECTORS:
            logger.info("Source '%s' not available: %s", key, reason)
