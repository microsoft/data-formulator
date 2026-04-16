"""Tests for Flask session configuration (secret key, lifetime, cookie flags)."""
from __future__ import annotations

import pytest

pytestmark = [pytest.mark.backend]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Ensure FLASK_SECRET_KEY is unset unless a test explicitly sets it."""
    monkeypatch.delenv("FLASK_SECRET_KEY", raising=False)


def _reload_app():
    """Force-reload the app module to pick up fresh env vars."""
    import importlib
    import data_formulator.app as app_mod
    importlib.reload(app_mod)
    return app_mod.app


class TestFlaskSecretKey:

    def test_uses_env_secret_key(self, monkeypatch):
        monkeypatch.setenv("FLASK_SECRET_KEY", "my-stable-key-123")
        app = _reload_app()
        assert app.secret_key == "my-stable-key-123"

    def test_falls_back_to_random_when_env_missing(self, monkeypatch):
        monkeypatch.delenv("FLASK_SECRET_KEY", raising=False)
        app = _reload_app()
        assert app.secret_key is not None
        assert len(app.secret_key) > 0


class TestSessionConfig:

    def test_permanent_session_lifetime_is_one_year(self):
        from data_formulator.app import app
        assert app.config["PERMANENT_SESSION_LIFETIME"] == 60 * 60 * 24 * 365

    def test_session_cookie_httponly(self):
        from data_formulator.app import app
        assert app.config["SESSION_COOKIE_HTTPONLY"] is True

    def test_session_cookie_samesite(self):
        from data_formulator.app import app
        assert app.config["SESSION_COOKIE_SAMESITE"] == "Lax"
