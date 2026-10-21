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

HOSTS = json.dumps({"demo.example.org": "demo", "other.example.org": "missing-site"})

# A site of the tests' own, so Data Formulator's tests do not depend on any site in sites/.
PROFILE = """\
name: Demo Explorer
badge: Beta
intro: For each dataset, open an example.
about:
  - "[Data Formulator](https://github.com/microsoft/data-formulator) explores data."
  - "This site loads the {release} release."
release: r1
hero_image: hero.png
analyst_rules: Write for curious general readers.
starters:
  - id: culture
    title: Culture
    file: culture.zip
  - id: education
    title: Education
    file: education.zip
"""


@pytest.fixture(autouse=True)
def _site_env(tmp_path, monkeypatch):
    monkeypatch.delenv("DF_SITE", raising=False)
    monkeypatch.setenv("DF_SITES", HOSTS)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("DF_SITES_DIR", str(tmp_path / "content"))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(tmp_path / "ephemeral"))
    (tmp_path / "content" / "demo").mkdir(parents=True)
    (tmp_path / "content" / "demo" / "profile.yaml").write_text(PROFILE, encoding="utf-8")
    monkeypatch.setattr(sites, "_REPO_DEMOS_DIR", tmp_path / "checkout" / "demos")
    load_profile = sites.site_profile
    load_profile.cache_clear()
    yield
    load_profile.cache_clear()


def _app() -> flask.Flask:
    app = flask.Flask(__name__)
    app.testing = True
    app.register_blueprint(site_bp)
    return app


def test_site_follows_hostname_and_ignores_unknown_sites():
    app = _app()
    with app.test_request_context("/", headers={"Host": "demo.example.org:443"}):
        assert sites.current_site() == "demo"
    with app.test_request_context("/", headers={"Host": "other.example.org"}):
        assert sites.current_site() is None
    with app.test_request_context("/", headers={"Host": "data-formulator.ai"}):
        assert sites.current_site() is None
    assert sites.current_site() is None  # outside a request


def test_forced_site_applies_everywhere(monkeypatch):
    monkeypatch.setenv("DF_SITE", "demo")
    assert sites.current_site() == "demo"
    monkeypatch.setenv("DF_SITE", "../etc")
    assert sites.current_site() is None


def test_site_analyst_rules_come_from_the_profile():
    assert "general readers" in sites.site_analyst_rules("demo")
    assert sites.site_analyst_rules(None) == ""
    assert sites.site_analyst_rules("missing") == ""


def test_user_home_is_namespaced_per_site(tmp_path):
    app = _app()
    with app.test_request_context("/", headers={"Host": "data-formulator.ai"}):
        default_home = get_user_home("browser:abc")
    with app.test_request_context("/", headers={"Host": "demo.example.org"}):
        site_home = get_user_home("browser:abc")
    assert default_home.parent == tmp_path / "home" / "users"
    assert site_home.parent == tmp_path / "home" / "sites" / "demo" / "users"
    assert site_home.name == default_home.name


def test_ephemeral_site_workspaces_expire_with_tombstones(tmp_path, monkeypatch):
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "1")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")
    with _app().test_request_context("/", headers={"Host": "demo.example.org"}):
        manager = EphemeralWorkspaceManager("browser:test")
        workspace_dir = manager.create_workspace("expired")
        assert workspace_dir.is_relative_to(tmp_path / "ephemeral" / "sites" / "demo" / "users")
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
    release_dir = tmp_path / "content" / "demo" / sites.site_profile("demo")["release"]
    release_dir.mkdir(parents=True)
    (release_dir / "culture.zip").write_bytes(b"zip")

    config = sites.site_frontend_config("demo")
    available = {starter["id"]: starter["available"] for starter in config["starters"]}
    assert config["name"]
    assert config["badge"] == "Beta"
    assert config["intro"].startswith("For each dataset")
    assert any("[Data Formulator](" in item for item in config["about"]) and any("{release}" in item for item in config["about"])
    assert available["culture"] is True
    assert available["education"] is False
    assert config["hero_image"] is None

    (release_dir / "hero.png").write_bytes(b"png")
    assert sites.site_frontend_config("demo")["hero_image"].startswith("/api/site/hero?v=")


def test_starter_download_only_serves_the_current_sites_profile_files(tmp_path):
    release_dir = tmp_path / "content" / "demo" / sites.site_profile("demo")["release"]
    release_dir.mkdir(parents=True)
    (release_dir / "culture.zip").write_bytes(b"zip-bytes")
    client = _app().test_client()

    response = client.get("/api/site/starters/culture", headers={"Host": "demo.example.org"})
    assert response.status_code == 200
    assert response.data == b"zip-bytes"

    from data_formulator.errors import AppError
    for host, starter in [("data-formulator.ai", "culture"), ("demo.example.org", "education"),
                          ("demo.example.org", "..")]:
        with pytest.raises(AppError):
            client.get(f"/api/site/starters/{starter}", headers={"Host": host})


def test_stories_carry_their_prompt_and_sessions_and_images_come_from_the_content_folder(tmp_path, monkeypatch):
    profile = {"id": "demo", "release": "r1", "starters": [{
        "id": "culture", "title": "Culture", "file": "culture.zip",
        "stories": [
            {"id": "heritage-spend", "headline": "Who pays for heritage", "dek": "A dek", "featured": True,
             "prompt": "  Chart who pays for heritage.  ", "follow_ups": ["Next?"], "file": "stories/heritage-spend.zip",
             "image": "stories/heritage-spend.png",
             "stack": [{"label": "Map", "image": "stories/heritage-spend-1.png"},
                       {"label": "Not drawn yet", "image": "stories/missing.png"},
                       {"label": "Trend", "image": "stories/heritage-spend-2.png"}]},
            {"id": "plain", "headline": "Later", "prompt": "Map it.", "file": "stories/plain.zip"},
            {"id": "escape", "headline": "Bad", "prompt": "x", "file": "../../outside.zip", "image": "../../outside.png"},
        ]}]}
    monkeypatch.setattr(sites, "site_profile", lambda site_id: profile if site_id == "demo" else None)
    release_dir = tmp_path / "content" / "demo" / "r1"
    (release_dir / "stories").mkdir(parents=True)
    (release_dir / "stories" / "heritage-spend.zip").write_bytes(b"story-zip")
    (release_dir / "stories" / "heritage-spend.png").write_bytes(b"png-bytes")
    (release_dir / "stories" / "heritage-spend-1.png").write_bytes(b"map-png")
    (release_dir / "stories" / "heritage-spend-2.png").write_bytes(b"trend-png")
    (tmp_path / "content" / "outside.png").write_bytes(b"secret")
    (tmp_path / "content" / "outside.zip").write_bytes(b"secret")

    stories = {story["id"]: story for story in sites.site_frontend_config("demo")["starters"][0]["stories"]}
    lead = stories["heritage-spend"]
    assert (lead["prompt"], lead["featured"], lead["follow_ups"]) == ("Chart who pays for heritage.", True, ["Next?"])
    assert (lead["available"], lead["session"]) == (True, "/api/site/stories/heritage-spend")
    assert not {"file", "questions", "includes"} & set(lead)
    # Not built yet: the page runs its prompt live instead.
    assert stories["plain"]["available"] is False
    assert stories["plain"]["follow_ups"] == [] and stories["plain"]["image"] is None and stories["plain"]["stack"] == []
    assert lead["image"].startswith("/api/site/stories/heritage-spend/image?v=")
    assert [(card["label"], card["image"].split("?v=")[0]) for card in lead["stack"]] == [
        ("Map", "/api/site/stories/heritage-spend/stack/0"), ("Trend", "/api/site/stories/heritage-spend/stack/2")]

    client = _app().test_client()
    host = {"Host": "demo.example.org"}
    assert client.get("/api/site/stories/heritage-spend/image", headers=host).data == b"png-bytes"
    assert client.get("/api/site/stories/heritage-spend/stack/2", headers=host).data == b"trend-png"
    assert client.get("/api/site/stories/heritage-spend", headers=host).data == b"story-zip"

    from data_formulator.errors import AppError
    for path in ["/api/site/stories/plain", "/api/site/stories/escape", "/api/site/stories/escape/image",
                 "/api/site/stories/unknown", "/api/site/stories/unknown/image",
                 "/api/site/stories/heritage-spend/stack/1", "/api/site/stories/heritage-spend/stack/9"]:
        with pytest.raises(AppError):
            client.get(path, headers=host)
    with pytest.raises(AppError):
        client.get("/api/site/stories/heritage-spend/image", headers={"Host": "data-formulator.ai"})


def test_profiles_come_from_the_sites_folder_then_the_checkout(tmp_path):
    checkout = tmp_path / "checkout" / "demos"
    (checkout / "example").mkdir(parents=True)
    (checkout / "example" / "profile.yaml").write_text("name: Example\n", encoding="utf-8")
    assert sites.site_profile("example") == {"name": "Example", "id": "example"}
    assert sites.site_profile("other") is None

    sites.site_profile.cache_clear()
    (checkout / "demo").mkdir(parents=True)
    (checkout / "demo" / "profile.yaml").write_text("name: Checkout\n", encoding="utf-8")
    assert sites.site_profile("demo")["name"] == "Demo Explorer"
    for invalid in ("../demo", "demo\n", "Demo", ""):
        assert sites.site_profile(invalid) is None


def test_frontend_config_passes_the_page_settings(tmp_path):
    (tmp_path / "content" / "demo" / "profile.yaml").write_text(PROFILE.replace(
        "    file: culture.zip\n", "    file: culture.zip\n    icon: landmark\n    start_note: All tables\n",
    ) + "disclaimer: Check the source.\n", encoding="utf-8")
    config = sites.site_frontend_config("demo")
    culture, education = config["starters"]
    assert (culture["icon"], culture["start_note"]) == ("landmark", "All tables")
    assert (education["icon"], education["start_note"]) == ("", "")
    assert config["disclaimer"] == "Check the source."


def test_sites_live_outside_the_package():
    package = sites._PACKAGE_DIR.resolve()
    assert not list((package / "sites").glob("*/profile.yaml"))


def test_configured_sites_missing_from_the_build_are_reported(monkeypatch, caplog):
    monkeypatch.setenv("DF_SITE", "demo")
    with caplog.at_level("WARNING", logger="data_formulator.sites"):
        sites.warn_about_missing_sites()
    messages = [record.getMessage() for record in caplog.records]
    assert any("'missing-site' is configured but" in message and "no valid profile.yaml" in message for message in messages)
    assert not any("'demo'" in message for message in messages)


@pytest.mark.parametrize("text, problem", [
    ("name: [unclosed\n", "cannot read"),
    ("- just\n- a list\n", "not a mapping"),
    ("starters: culture\n", "'starters' is not a list"),
    ("starters:\n  - title: No id\n", "has no 'id'"),
    ("starters:\n  - id: culture\n    stories: oops\n", "'stories' is not a list"),
    ("links: https://example.org\n", "'links' is not a list"),
    ("starters:\n  - id: culture\n    stories:\n      - id: s1\n        headline: No prompt\n", "needs an 'id' and a 'prompt'"),
])
def test_an_invalid_profile_disables_the_site_without_breaking_requests(tmp_path, monkeypatch, caplog, text, problem):
    (tmp_path / "content" / "demo" / "profile.yaml").write_text(text, encoding="utf-8")
    monkeypatch.setenv("DF_SITE", "demo")
    with caplog.at_level("ERROR", logger="data_formulator.sites"):
        assert sites.site_profile("demo") is None
        assert sites.current_site() is None
    assert any(problem in record.getMessage() for record in caplog.records)
