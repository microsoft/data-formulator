# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for URL allowlist (SSRF protection for user-provided api_base)."""

import os
from unittest.mock import patch

import pytest

from data_formulator.security.url_allowlist import validate_api_base, _load_patterns

pytestmark = [pytest.mark.backend, pytest.mark.security]


# ===================================================================
# Open mode (env var unset) — everything allowed
# ===================================================================

class TestOpenMode:
    """When DF_ALLOWED_API_BASES is unset, all URLs are permitted."""

    @patch.dict(os.environ, {}, clear=True)
    def test_any_url_allowed(self):
        validate_api_base("https://evil.example.com/v1")  # should not raise

    @patch.dict(os.environ, {}, clear=True)
    def test_private_ip_allowed_in_open_mode(self):
        validate_api_base("http://169.254.169.254/latest/meta-data/")

    @patch.dict(os.environ, {}, clear=True)
    def test_localhost_allowed_in_open_mode(self):
        validate_api_base("http://localhost:11434")

    @patch.dict(os.environ, {}, clear=True)
    def test_empty_base_allowed(self):
        validate_api_base("")

    @patch.dict(os.environ, {}, clear=True)
    def test_none_base_allowed(self):
        validate_api_base(None)


# ===================================================================
# Enforce mode — only allowlisted patterns pass
# ===================================================================

ALLOWLIST = "https://api.openai.com/*,https://*.openai.azure.com/*,http://localhost:11434/*"


class TestEnforceMode:
    """When DF_ALLOWED_API_BASES is set, only matching URLs pass."""

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_openai_allowed(self):
        validate_api_base("https://api.openai.com/v1")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_azure_wildcard_allowed(self):
        validate_api_base("https://myorg.openai.azure.com/openai/deployments")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_ollama_localhost_allowed(self):
        validate_api_base("http://localhost:11434/api/generate")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_unlisted_url_rejected(self):
        with pytest.raises(ValueError, match="allowlist"):
            validate_api_base("https://evil.example.com/v1")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_private_ip_rejected(self):
        with pytest.raises(ValueError, match="allowlist"):
            validate_api_base("http://169.254.169.254/latest/meta-data/")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_internal_network_rejected(self):
        with pytest.raises(ValueError, match="allowlist"):
            validate_api_base("http://10.0.0.1:8080/v1")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ALLOWLIST})
    def test_localhost_wrong_port_rejected(self):
        with pytest.raises(ValueError, match="allowlist"):
            validate_api_base("http://localhost:6379/")


# ===================================================================
# Empty / None api_base always allowed (provider defaults)
# ===================================================================

class TestEmptyBaseAlwaysAllowed:
    """Empty api_base means 'use provider default' — always OK."""

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://api.openai.com/*"})
    def test_none_allowed_in_enforce_mode(self):
        validate_api_base(None)

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://api.openai.com/*"})
    def test_empty_string_allowed_in_enforce_mode(self):
        validate_api_base("")


# ===================================================================
# Case insensitivity
# ===================================================================

class TestCaseInsensitive:

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://api.openai.com/*"})
    def test_uppercase_url_matches(self):
        validate_api_base("HTTPS://API.OPENAI.COM/v1")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "HTTPS://API.OPENAI.COM/*"})
    def test_uppercase_pattern_matches(self):
        validate_api_base("https://api.openai.com/v1")


# ===================================================================
# Pattern loading
# ===================================================================

class TestPatternLoading:

    @patch.dict(os.environ, {}, clear=True)
    def test_unset_returns_none(self):
        assert _load_patterns() is None

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": ""})
    def test_empty_string_returns_none(self):
        assert _load_patterns() is None

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "  "})
    def test_whitespace_only_returns_none(self):
        assert _load_patterns() is None

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://a.com/*,https://b.com/*"})
    def test_comma_separated_parsed(self):
        patterns = _load_patterns()
        assert len(patterns) == 2
        assert "https://a.com/*" in patterns

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": " https://a.com/* , https://b.com/* "})
    def test_whitespace_trimmed(self):
        patterns = _load_patterns()
        assert patterns == ["https://a.com/*", "https://b.com/*"]


# ===================================================================
# Glob edge cases
# ===================================================================

class TestGlobEdgeCases:

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://*.openai.azure.com/*"})
    def test_subdomain_wildcard(self):
        validate_api_base("https://contoso.openai.azure.com/openai/v1")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://*.openai.azure.com/*"})
    def test_deep_subdomain_wildcard(self):
        validate_api_base("https://dept.contoso.openai.azure.com/openai/v1")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://api.openai.com/*"})
    def test_no_path_still_matches_with_slash(self):
        validate_api_base("https://api.openai.com/")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://api.openai.com/*"})
    def test_exact_domain_no_trailing_slash_no_match(self):
        """'https://api.openai.com' does NOT match 'https://api.openai.com/*'
        because fnmatch requires the / after .com for the /* pattern."""
        with pytest.raises(ValueError, match="allowlist"):
            validate_api_base("https://api.openai.com")

    @patch.dict(os.environ, {"DF_ALLOWED_API_BASES": "https://api.openai.com*"})
    def test_pattern_without_slash_star_matches_bare_domain(self):
        """Pattern ending in * (no /) matches the bare domain too."""
        validate_api_base("https://api.openai.com")
        validate_api_base("https://api.openai.com/v1")
