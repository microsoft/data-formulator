# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Credential Vault factory — returns the global vault instance.

Key resolution (first match wins):

1. ``CREDENTIAL_VAULT_KEY`` env var  — explicit key (server deployments)
2. ``DATA_FORMULATOR_HOME/.vault_key`` file — auto-generated on first run
3. Neither → vault disabled, plugins fall back to session-only storage

For local single-user mode the vault is **zero-config**: a Fernet key is
auto-generated on first access and persisted to the data directory.  Server
admins who want deterministic keys (e.g. for Docker volume mounts) can set
``CREDENTIAL_VAULT_KEY`` explicitly.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from .base import CredentialVault

logger = logging.getLogger(__name__)

_vault: Optional[CredentialVault] = None
_initialized = False


def get_data_formulator_home() -> Path:
    """Lazy import to avoid circular deps at module load time."""
    from data_formulator.datalake.workspace import get_data_formulator_home as _home
    return _home()


def _resolve_key(home: Path) -> Optional[str]:
    """Resolve the Fernet encryption key.

    Priority:
    1. CREDENTIAL_VAULT_KEY env var (explicit, for server deployments)
    2. Auto-generated key file at ``home/.vault_key``
    """
    env_key = os.environ.get("CREDENTIAL_VAULT_KEY", "").strip()
    if env_key:
        return env_key

    key_file = home / ".vault_key"
    if key_file.exists():
        stored = key_file.read_text(encoding="utf-8").strip()
        if stored:
            return stored

    # Auto-generate a new key for local use
    try:
        from cryptography.fernet import Fernet

        new_key = Fernet.generate_key().decode()
        key_file.parent.mkdir(parents=True, exist_ok=True)
        key_file.write_text(new_key + "\n", encoding="utf-8")
        logger.info("Generated new vault key: %s", key_file)
        return new_key
    except Exception as exc:
        logger.warning("Failed to auto-generate vault key: %s", exc)
        return None


def get_credential_vault() -> Optional[CredentialVault]:
    """Return the global :class:`CredentialVault` singleton.

    Returns ``None`` when:
    - Data connectors are disabled (nothing needs credentials)
    - Key resolution fails
    """
    global _vault, _initialized
    if _initialized:
        return _vault

    _initialized = True

    # Skip vault creation when data connectors are disabled (e.g. ephemeral
    # demo deployments).  No connectors → no credentials to store.
    try:
        from flask import current_app
        if current_app.config.get('CLI_ARGS', {}).get('disable_data_connectors'):
            logger.info("Credential vault skipped (data connectors disabled)")
            return None
    except RuntimeError:
        pass  # Outside Flask request context — continue normally

    home = get_data_formulator_home()
    key = _resolve_key(home)
    if not key:
        logger.info("Credential vault disabled (no key available)")
        return None

    vault_type = os.environ.get("CREDENTIAL_VAULT", "local").strip().lower()

    if vault_type == "local":
        from .local_vault import LocalCredentialVault

        db_path = home / "credentials.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _vault = LocalCredentialVault(db_path, key)
        logger.info("Credential vault initialized: local (%s)", db_path)
    else:
        logger.warning("Unknown credential vault type: %s", vault_type)

    return _vault
