# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for HMAC-based code signing (code_signing.py).

Verifies that transformation code is signed before being returned to the
frontend, and that tampered or unsigned code is rejected before sandbox
execution.
"""

import pytest

from data_formulator.security.code_signing import sign_code, verify_code, sign_result

pytestmark = [pytest.mark.backend]


# ===================================================================
# sign_code / verify_code round-trip
# ===================================================================

class TestSignVerifyRoundTrip:

    def test_valid_signature_accepted(self):
        code = "output_df = pd.DataFrame({'a': [1, 2, 3]})"
        sig = sign_code(code)
        assert verify_code(code, sig)

    def test_tampered_code_rejected(self):
        code = "output_df = pd.DataFrame({'a': [1, 2, 3]})"
        sig = sign_code(code)
        tampered = code.replace("1, 2, 3", "1, 2, 3, 4")
        assert not verify_code(tampered, sig)

    def test_tampered_signature_rejected(self):
        code = "output_df = pd.DataFrame({'a': [1]})"
        sig = sign_code(code)
        bad_sig = sig[:-4] + "dead"
        assert not verify_code(code, bad_sig)

    def test_empty_code_returns_empty_sig(self):
        assert sign_code("") == ""

    def test_empty_code_verify_returns_false(self):
        assert not verify_code("", "anything")

    def test_empty_signature_verify_returns_false(self):
        assert not verify_code("some code", "")

    def test_whitespace_matters(self):
        """Trailing whitespace changes the signature."""
        code = "output_df = pd.DataFrame()"
        sig = sign_code(code)
        assert not verify_code(code + " ", sig)

    def test_unicode_code(self):
        """Non-ASCII code signs and verifies correctly."""
        code = 'output_df = pd.DataFrame({"名前": ["太郎"]})'
        sig = sign_code(code)
        assert verify_code(code, sig)


# ===================================================================
# sign_result helper
# ===================================================================

class TestSignResult:

    def test_adds_signature_when_code_present(self):
        result = {"code": "output_df = pd.DataFrame()", "data": [1, 2, 3]}
        sign_result(result)
        assert "code_signature" in result
        assert verify_code(result["code"], result["code_signature"])

    def test_no_signature_when_code_empty(self):
        result = {"code": "", "data": [1]}
        sign_result(result)
        assert result.get("code_signature") is None or result.get("code_signature") == ""

    def test_no_signature_when_code_missing(self):
        result = {"data": [1]}
        sign_result(result)
        assert "code_signature" not in result or result.get("code_signature") is None

    def test_returns_result_for_chaining(self):
        result = {"code": "x = 1"}
        assert sign_result(result) is result


# ===================================================================
# Signing key source
# ===================================================================

class TestSigningKeySource:

    @pytest.fixture(autouse=True)
    def _isolated_home(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
        monkeypatch.delenv("DF_CODE_SIGNING_SECRET", raising=False)
        monkeypatch.delenv("FLASK_SECRET_KEY", raising=False)
        return tmp_path

    def test_old_fixed_dev_key_cannot_forge(self):
        import hashlib
        import hmac
        code = "import os"
        forged = hmac.new(b"data-formulator-dev-signing-key", code.encode(), hashlib.sha256).hexdigest()
        assert not verify_code(code, forged)

    def test_installation_key_is_random_private_and_stable(self, _isolated_home):
        import os
        signature = sign_code("x = 1")
        key_file = _isolated_home / ".code-signing-key"
        assert len(bytes.fromhex(key_file.read_text())) == 32
        if os.name == "posix":
            assert key_file.stat().st_mode & 0o777 == 0o600
        assert sign_code("x = 1") == signature

    def test_explicit_and_flask_secrets_take_priority(self, monkeypatch, _isolated_home):
        monkeypatch.setenv("FLASK_SECRET_KEY", "flask-secret")
        from_flask = sign_code("x = 1")
        monkeypatch.setenv("DF_CODE_SIGNING_SECRET", "explicit")
        assert sign_code("x = 1") != from_flask
        assert not (_isolated_home / ".code-signing-key").exists()
