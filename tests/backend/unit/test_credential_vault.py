"""Unit tests for :class:`LocalCredentialVault`.

Verifies:
- store / retrieve round-trip with real Fernet encryption
- User isolation (user_a cannot read user_b's credentials)
- Overwrite semantics (second store replaces first)
- delete removes credential; subsequent retrieve returns None
- list_sources tracks stored source keys accurately
- Decryption failure (wrong key) returns None gracefully
- Invalid encryption key raises on construction
"""
from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

pytestmark = [pytest.mark.backend, pytest.mark.vault]


def _make_vault(tmp_path, key=None):
    from data_formulator.credential_vault.local_vault import LocalCredentialVault

    if key is None:
        key = Fernet.generate_key().decode()
    return LocalCredentialVault(tmp_path / "creds.db", key)


class TestStoreAndRetrieve:

    def test_round_trip(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"username": "alice", "password": "s3cret"})
        got = vault.retrieve("user:alice", "superset")
        assert got == {"username": "alice", "password": "s3cret"}

    def test_retrieve_missing_returns_none(self, tmp_path):
        vault = _make_vault(tmp_path)
        assert vault.retrieve("user:alice", "superset") is None

    def test_overwrite(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"password": "old"})
        vault.store("user:alice", "superset", {"password": "new"})
        assert vault.retrieve("user:alice", "superset") == {"password": "new"}


class TestUserIsolation:

    def test_different_users_isolated(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"password": "alice_pw"})
        vault.store("user:bob", "superset", {"password": "bob_pw"})
        assert vault.retrieve("user:alice", "superset")["password"] == "alice_pw"
        assert vault.retrieve("user:bob", "superset")["password"] == "bob_pw"

    def test_cross_user_retrieve_returns_none(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"password": "alice_pw"})
        assert vault.retrieve("user:bob", "superset") is None

    def test_browser_identity_works(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("browser:uuid-123", "superset", {"password": "pw"})
        assert vault.retrieve("browser:uuid-123", "superset") == {"password": "pw"}
        assert vault.retrieve("browser:uuid-999", "superset") is None


class TestDelete:

    def test_delete_removes_credential(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"password": "pw"})
        vault.delete("user:alice", "superset")
        assert vault.retrieve("user:alice", "superset") is None

    def test_delete_nonexistent_is_noop(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.delete("user:alice", "superset")  # should not raise

    def test_delete_one_source_keeps_others(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"pw": "1"})
        vault.store("user:alice", "metabase", {"pw": "2"})
        vault.delete("user:alice", "superset")
        assert vault.retrieve("user:alice", "superset") is None
        assert vault.retrieve("user:alice", "metabase") == {"pw": "2"}


class TestListSources:

    def test_empty_initially(self, tmp_path):
        vault = _make_vault(tmp_path)
        assert vault.list_sources("user:alice") == []

    def test_lists_stored_sources(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"pw": "1"})
        vault.store("user:alice", "metabase", {"pw": "2"})
        sources = vault.list_sources("user:alice")
        assert set(sources) == {"superset", "metabase"}

    def test_list_after_delete(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"pw": "1"})
        vault.store("user:alice", "metabase", {"pw": "2"})
        vault.delete("user:alice", "superset")
        assert vault.list_sources("user:alice") == ["metabase"]

    def test_list_isolated_per_user(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"pw": "1"})
        vault.store("user:bob", "metabase", {"pw": "2"})
        assert vault.list_sources("user:alice") == ["superset"]
        assert vault.list_sources("user:bob") == ["metabase"]


class TestEncryptionKeyMismatch:

    def test_wrong_key_returns_none(self, tmp_path):
        key1 = Fernet.generate_key().decode()
        key2 = Fernet.generate_key().decode()
        assert key1 != key2

        vault1 = _make_vault(tmp_path, key=key1)
        vault1.store("user:alice", "superset", {"password": "s3cret"})

        vault2 = _make_vault(tmp_path, key=key2)
        assert vault2.retrieve("user:alice", "superset") is None

    def test_invalid_key_raises(self, tmp_path):
        with pytest.raises(Exception):
            _make_vault(tmp_path, key="not-a-valid-fernet-key")


class TestEdgeCases:

    def test_complex_credentials(self, tmp_path):
        vault = _make_vault(tmp_path)
        creds = {
            "username": "user@example.com",
            "password": "p@$$w0rd!#&*",
            "api_key": "sk-abc123xyz",
            "nested": {"token": "eyJhbGci..."},
        }
        vault.store("user:alice", "service", creds)
        assert vault.retrieve("user:alice", "service") == creds

    def test_unicode_credentials(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {"password": "密码测试🔐"})
        assert vault.retrieve("user:alice", "superset") == {"password": "密码测试🔐"}

    def test_empty_credentials_dict(self, tmp_path):
        vault = _make_vault(tmp_path)
        vault.store("user:alice", "superset", {})
        assert vault.retrieve("user:alice", "superset") == {}
