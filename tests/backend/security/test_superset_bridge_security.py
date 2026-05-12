# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Security tests for the Superset SSO bridge test configuration.

The bridge posts short-lived JWTs back to the Data Formulator frontend, so it
must restrict target origins and render token payloads safely inside scripts.
"""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest
from flask import Flask

pytestmark = [pytest.mark.backend, pytest.mark.security]


def _load_superset_config():
    created_flask_login_stub = False
    if "flask_login" not in sys.modules:
        flask_login = types.ModuleType("flask_login")
        flask_login.current_user = types.SimpleNamespace(is_authenticated=False)
        sys.modules["flask_login"] = flask_login
        created_flask_login_stub = True

    config_path = (
        Path(__file__).parents[2]
        / "database-dockers"
        / "superset"
        / "superset_config.py"
    )
    spec = importlib.util.spec_from_file_location(
        "_df_test_superset_config", config_path,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    finally:
        if created_flask_login_stub:
            sys.modules.pop("flask_login", None)
    return module


class TestSupersetBridgeOriginValidation:

    def test_allows_known_data_formulator_origins(self):
        config = _load_superset_config()

        assert (
            config._validate_df_origin("http://localhost:5567")
            == "http://localhost:5567"
        )
        assert (
            config._validate_df_origin("http://127.0.0.1:5173/")
            == "http://127.0.0.1:5173"
        )

    @pytest.mark.parametrize("raw_origin", [
        "",
        "*",
        "javascript:alert(1)",
        "http://localhost:5567/path",
        "http://user:pass@localhost:5567",
        "https://evil.example.com",
    ])
    def test_rejects_untrusted_or_non_origin_values(self, raw_origin):
        config = _load_superset_config()

        assert config._validate_df_origin(raw_origin) == ""

    def test_allows_env_configured_origin(self, monkeypatch):
        config = _load_superset_config()
        monkeypatch.setenv("DF_ALLOWED_ORIGINS", "https://df.example.com")

        assert (
            config._validate_df_origin("https://df.example.com")
            == "https://df.example.com"
        )


class TestSupersetBridgeTemplate:

    def test_script_payload_escapes_script_breakout(self):
        config = _load_superset_config()
        app = Flask(__name__)
        payload = {
            "type": "df-sso-auth",
            "access_token": "token",
            "refresh_token": "refresh",
            "user": {"username": "</script><script>alert(1)</script>"},
        }

        with app.app_context():
            html = config.render_template_string(
                config._SSO_BRIDGE_TEMPLATE,
                payload=payload,
                target_origin="http://localhost:5567",
            )

        assert "</script><script>alert(1)</script>" not in html
        assert "\\u003c/script\\u003e" in html
