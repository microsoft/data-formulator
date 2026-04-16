# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""SQLite + Fernet encrypted credential vault.

Storage location: ``DATA_FORMULATOR_HOME/credentials.db``

Generate a Fernet key::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet

from .base import CredentialVault

logger = logging.getLogger(__name__)


class LocalCredentialVault(CredentialVault):
    """Fernet-encrypted credentials backed by a local SQLite database."""

    def __init__(self, db_path: str | Path, encryption_key: str) -> None:
        self._db_path = str(db_path)
        self._fernet = Fernet(
            encryption_key.encode() if isinstance(encryption_key, str) else encryption_key,
        )
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS credentials (
                    user_id      TEXT NOT NULL,
                    source_key   TEXT NOT NULL,
                    encrypted_data BLOB NOT NULL,
                    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, source_key)
                )
            """)

    # ------------------------------------------------------------------

    def store(self, user_id: str, source_key: str, credentials: dict) -> None:
        encrypted = self._fernet.encrypt(json.dumps(credentials).encode("utf-8"))
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO credentials "
                "(user_id, source_key, encrypted_data, updated_at) "
                "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
                (user_id, source_key, encrypted),
            )
        logger.debug("Stored credentials for %s / %s", user_id[:16], source_key)

    def retrieve(self, user_id: str, source_key: str) -> Optional[dict]:
        with sqlite3.connect(self._db_path) as conn:
            row = conn.execute(
                "SELECT encrypted_data FROM credentials "
                "WHERE user_id = ? AND source_key = ?",
                (user_id, source_key),
            ).fetchone()
        if not row:
            return None
        try:
            decrypted = self._fernet.decrypt(row[0])
            return json.loads(decrypted.decode("utf-8"))
        except Exception as exc:
            logger.warning(
                "Failed to decrypt credentials for %s / %s: %s",
                user_id[:16], source_key, exc,
            )
            return None

    def delete(self, user_id: str, source_key: str) -> None:
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "DELETE FROM credentials WHERE user_id = ? AND source_key = ?",
                (user_id, source_key),
            )

    def list_sources(self, user_id: str) -> list[str]:
        with sqlite3.connect(self._db_path) as conn:
            rows = conn.execute(
                "SELECT source_key FROM credentials WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        return [r[0] for r in rows]
