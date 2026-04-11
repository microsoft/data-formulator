# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Abstract interface for credential storage backends."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional


class CredentialVault(ABC):
    """Encrypted per-user credential storage.

    Credentials are keyed by ``(user_identity, source_key)``:

    - *user_identity* comes from :func:`auth.get_identity_id`
      (e.g. ``"user:alice@corp.com"`` or ``"browser:uuid-123"``)
    - *source_key* is the plugin ID (e.g. ``"superset"``, ``"metabase"``)
    """

    @abstractmethod
    def store(self, user_id: str, source_key: str, credentials: dict) -> None:
        """Store (or overwrite) credentials for *(user_id, source_key)*."""
        ...

    @abstractmethod
    def retrieve(self, user_id: str, source_key: str) -> Optional[dict]:
        """Retrieve credentials, or ``None`` if absent / undecryptable."""
        ...

    @abstractmethod
    def delete(self, user_id: str, source_key: str) -> None:
        """Delete credentials.  No-op if nothing stored."""
        ...

    @abstractmethod
    def list_sources(self, user_id: str) -> list[str]:
        """Return source_keys that have stored credentials for *user_id*."""
        ...
