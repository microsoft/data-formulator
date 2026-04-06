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

    def test_signature_is_hex_string(self):
        sig = sign_code("x = 1")
        assert isinstance(sig, str)
        assert len(sig) == 64  # SHA-256 hex
        int(sig, 16)  # should not raise


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
