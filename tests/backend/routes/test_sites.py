"""Tests for site profiles: hostname selection, storage namespace, starter sessions."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import flask
import pytest

from data_formulator import sites
from data_formulator.datalake.ephemeral_workspace import (
    EphemeralWorkspaceManager,
    cleanup_ephemeral_workspaces,
)
from data_formulator.datalake.workspace import get_user_home
from data_formulator.datalake.workspace_manager import WORKSPACE_META_FILENAME
from data_formulator.sites.routes import site_bp

pytestmark = [pytest.mark.backend]

HOSTS = json.dumps({"unesco.example.org": "unesco", "other.example.org": "missing-site"})


@pytest.fixture(autouse=True)
def _site_env(tmp_path, monkeypatch):
    monkeypatch.delenv("DF_SITE", raising=False)
    monkeypatch.setenv("DF_SITES", HOSTS)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("DF_SITES_DIR", str(tmp_path / "content"))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(tmp_path / "ephemeral"))


def _app() -> flask.Flask:
    app = flask.Flask(__name__)
    app.testing = True
    app.register_blueprint(site_bp)
    return app


def test_site_follows_hostname_and_ignores_unknown_sites():
    app = _app()
    with app.test_request_context("/", headers={"Host": "unesco.example.org:443"}):
        assert sites.current_site() == "unesco"
    with app.test_request_context("/", headers={"Host": "other.example.org"}):
        assert sites.current_site() is None
    with app.test_request_context("/", headers={"Host": "data-formulator.ai"}):
        assert sites.current_site() is None
    assert sites.current_site() is None  # outside a request


def test_forced_site_applies_everywhere(monkeypatch):
    monkeypatch.setenv("DF_SITE", "unesco")
    assert sites.current_site() == "unesco"
    monkeypatch.setenv("DF_SITE", "../etc")
    assert sites.current_site() is None


def test_user_home_is_namespaced_per_site(tmp_path):
    app = _app()
    with app.test_request_context("/", headers={"Host": "data-formulator.ai"}):
        default_home = get_user_home("browser:abc")
    with app.test_request_context("/", headers={"Host": "unesco.example.org"}):
        site_home = get_user_home("browser:abc")
    assert default_home.parent == tmp_path / "home" / "users"
    assert site_home.parent == tmp_path / "home" / "sites" / "unesco" / "users"
    assert site_home.name == default_home.name


def test_ephemeral_site_workspaces_expire_with_tombstones(tmp_path, monkeypatch):
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "1")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")
    with _app().test_request_context("/", headers={"Host": "unesco.example.org"}):
        manager = EphemeralWorkspaceManager("browser:test")
        workspace_dir = manager.create_workspace("expired")
        assert workspace_dir.is_relative_to(tmp_path / "ephemeral" / "sites" / "unesco" / "users")
        meta_file = workspace_dir / WORKSPACE_META_FILENAME
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        meta["updatedAt"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        meta_file.write_text(json.dumps(meta), encoding="utf-8")

        assert cleanup_ephemeral_workspaces(force=True) == 1
        assert not workspace_dir.exists()
        assert manager.workspace_was_evicted("expired")
    with _app().test_request_context("/", headers={"Host": "data-formulator.ai"}):
        assert not EphemeralWorkspaceManager("browser:test").workspace_was_evicted("expired")


def test_frontend_config_reports_starter_availability(tmp_path):
    release_dir = tmp_path / "content" / "unesco" / sites.site_profile("unesco")["release"]
    release_dir.mkdir(parents=True)
    (release_dir / "culture.zip").write_bytes(b"zip")

    config = sites.site_frontend_config("unesco")
    available = {starter["id"]: starter["available"] for starter in config["starters"]}
    assert config["name"]
    assert available["culture"] is True
    assert available["education-sdg4"] is False


def test_starter_download_only_serves_the_current_sites_profile_files(tmp_path):
    release_dir = tmp_path / "content" / "unesco" / sites.site_profile("unesco")["release"]
    release_dir.mkdir(parents=True)
    (release_dir / "culture.zip").write_bytes(b"zip-bytes")
    client = _app().test_client()

    response = client.get("/api/site/starters/culture", headers={"Host": "unesco.example.org"})
    assert response.status_code == 200
    assert response.data == b"zip-bytes"

    from data_formulator.errors import AppError
    for host, starter in [("data-formulator.ai", "culture"), ("unesco.example.org", "science"),
                          ("unesco.example.org", "..")]:
        with pytest.raises(AppError):
            client.get(f"/api/site/starters/{starter}", headers={"Host": host})
