"""Tests for demos ("sites"): selection by the X-DF-Demo header, storage namespace, content, install."""

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

DEMO = {"X-DF-Demo": "demo"}

# A demo of the tests' own, so these tests do not depend on the demos Data Formulator ships.
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
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("DF_SITES_DIR", str(tmp_path / "content"))
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_ROOT", str(tmp_path / "ephemeral"))
    (tmp_path / "content" / "demo").mkdir(parents=True)
    (tmp_path / "content" / "demo" / "profile.yaml").write_text(PROFILE, encoding="utf-8")
    monkeypatch.setattr(sites, "PACKAGED_DEMOS", tmp_path / "shipped")
    load_profile = sites.site_profile
    load_profile.cache_clear()
    yield
    load_profile.cache_clear()


def _app() -> flask.Flask:
    app = flask.Flask(__name__)
    app.testing = True
    app.register_blueprint(site_bp)
    return app


def test_site_follows_the_demo_header_and_ignores_unknown_demos(monkeypatch):
    app = _app()
    with app.test_request_context("/", headers=DEMO):
        assert sites.current_site() == "demo"
    for value in ("missing-site", "../etc", "Demo", ""):
        with app.test_request_context("/", headers={"X-DF-Demo": value}):
            assert sites.current_site() is None
    with app.test_request_context("/"):
        assert sites.current_site() is None
    monkeypatch.setenv("DF_SITE", "demo")
    with app.test_request_context("/"):
        assert sites.current_site() is None  # DF_SITE only picks the demo / opens
    assert sites.current_site() is None  # outside a request


def test_default_demo_is_the_configured_one_when_it_exists(monkeypatch):
    assert sites.default_demo() is None
    monkeypatch.setenv("DF_SITE", "demo")
    assert sites.default_demo() == "demo"
    monkeypatch.setenv("DF_SITE", "../etc")
    assert sites.default_demo() is None


def test_site_analyst_rules_come_from_the_profile():
    assert "general readers" in sites.site_analyst_rules("demo")
    assert sites.site_analyst_rules(None) == ""
    assert sites.site_analyst_rules("missing") == ""


def test_user_home_is_namespaced_per_site(tmp_path):
    app = _app()
    with app.test_request_context("/"):
        default_home = get_user_home("browser:abc")
    with app.test_request_context("/", headers=DEMO):
        site_home = get_user_home("browser:abc")
    assert default_home.parent == tmp_path / "home" / "users"
    assert site_home.parent == tmp_path / "home" / "sites" / "demo" / "users"
    assert site_home.name == default_home.name


def test_ephemeral_site_workspaces_expire_with_tombstones(tmp_path, monkeypatch):
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_TTL_HOURS", "1")
    monkeypatch.setenv("EPHEMERAL_WORKSPACE_MAX_BYTES", "0")
    with _app().test_request_context("/", headers=DEMO):
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
    with _app().test_request_context("/"):
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
    assert sites.site_frontend_config("demo")["hero_image"].startswith("/api/demos/demo/hero?v=")


def test_starter_download_only_serves_the_demos_profile_files(tmp_path):
    release_dir = tmp_path / "content" / "demo" / sites.site_profile("demo")["release"]
    release_dir.mkdir(parents=True)
    (release_dir / "culture.zip").write_bytes(b"zip-bytes")
    client = _app().test_client()

    response = client.get("/api/demos/demo/starters/culture")
    assert response.status_code == 200
    assert response.data == b"zip-bytes"

    from data_formulator.errors import AppError
    for site, starter in [("missing-site", "culture"), ("demo", "education"), ("demo", "..")]:
        with pytest.raises(AppError):
            client.get(f"/api/demos/{site}/starters/{starter}")


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
    assert (lead["available"], lead["session"]) == (True, "/api/demos/demo/stories/heritage-spend")
    assert not {"file", "questions", "includes"} & set(lead)
    # Not built yet: the page runs its prompt live instead.
    assert stories["plain"]["available"] is False
    assert stories["plain"]["follow_ups"] == [] and stories["plain"]["image"] is None and stories["plain"]["stack"] == []
    assert lead["image"].startswith("/api/demos/demo/stories/heritage-spend/image?v=")
    assert [(card["label"], card["image"].split("?v=")[0]) for card in lead["stack"]] == [
        ("Map", "/api/demos/demo/stories/heritage-spend/stack/0"), ("Trend", "/api/demos/demo/stories/heritage-spend/stack/2")]

    client = _app().test_client()
    assert client.get("/api/demos/demo/stories/heritage-spend/image").data == b"png-bytes"
    assert client.get("/api/demos/demo/stories/heritage-spend/stack/2").data == b"trend-png"
    assert client.get("/api/demos/demo/stories/heritage-spend").data == b"story-zip"

    from data_formulator.errors import AppError
    for path in ["/api/demos/demo/stories/plain", "/api/demos/demo/stories/escape", "/api/demos/demo/stories/escape/image",
                 "/api/demos/demo/stories/unknown", "/api/demos/demo/stories/unknown/image",
                 "/api/demos/demo/stories/heritage-spend/stack/1", "/api/demos/demo/stories/heritage-spend/stack/9"]:
        with pytest.raises(AppError):
            client.get(path)
    with pytest.raises(AppError):
        client.get("/api/demos/other/stories/heritage-spend/image")


def test_profiles_come_from_the_sites_folder_then_the_shipped_demos(tmp_path):
    checkout = tmp_path / "shipped"
    (checkout / "example").mkdir(parents=True)
    (checkout / "example" / "profile.yaml").write_text("name: Example\n", encoding="utf-8")
    assert sites.site_profile("example") == {"name": "Example", "id": "example"}
    assert sites.site_profile("other") is None

    sites.site_profile.cache_clear()
    (checkout / "demo").mkdir(parents=True)
    (checkout / "demo" / "profile.yaml").write_text("name: Shipped\n", encoding="utf-8")
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


def test_a_default_demo_that_does_not_exist_is_reported(monkeypatch, caplog):
    monkeypatch.setenv("DF_SITE", "demo")
    with caplog.at_level("WARNING", logger="data_formulator.sites"):
        sites.warn_about_missing_sites()
    assert not caplog.records
    monkeypatch.setenv("DF_SITE", "missing-site")
    with caplog.at_level("WARNING", logger="data_formulator.sites"):
        sites.warn_about_missing_sites()
    assert any("DF_SITE='missing-site' names no demo" in record.getMessage() for record in caplog.records)


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
    with caplog.at_level("ERROR", logger="data_formulator.sites"), _app().test_request_context("/", headers=DEMO):
        assert sites.site_profile("demo") is None
        assert sites.current_site() is None
    assert any(problem in record.getMessage() for record in caplog.records)


def test_demo_status_is_ready_once_every_named_file_is_installed(tmp_path):
    assert sites.demo_status("missing-site") is None
    assert sites.demo_status("demo") == "not_installed"
    release_dir = tmp_path / "content" / "demo" / "r1"
    release_dir.mkdir(parents=True)
    for name in ("culture.zip", "education.zip"):
        (release_dir / name).write_bytes(b"zip")
    assert sites.demo_status("demo") == "not_installed"  # the hero image is missing
    (release_dir / "hero.png").write_bytes(b"png")
    assert sites.demo_status("demo") == "ready"


# A shipped demo whose build.py installs its content the way a real one does.
SHIPPED_BUILD = """\
from pathlib import Path

def install(sites, raw=None, *, log=print, **options):
    if (Path(sites) / "fail-on-purpose").exists():
        raise RuntimeError("download failed")
    site = Path(sites) / "shipped-demo"
    (site / "r1").mkdir(parents=True, exist_ok=True)
    (site / "r1" / "data.zip").write_bytes(b"zip")
    log("built data")
    return site
"""


def _shipped_demo(tmp_path):
    folder = tmp_path / "shipped" / "shipped-demo"
    folder.mkdir(parents=True)
    (folder / "profile.yaml").write_text(
        "name: Shipped\nrelease: r1\nstarters:\n  - id: data\n    file: data.zip\n", encoding="utf-8")
    (folder / "build.py").write_text(SHIPPED_BUILD, encoding="utf-8")


def _wait_for_install(client):
    import time
    for _ in range(200):
        status = client.get("/api/demos/shipped-demo/install").get_json()["data"]
        if status["job"]["state"] != "running":
            return status
        time.sleep(0.02)
    raise AssertionError("the install did not finish")


def test_a_local_install_builds_the_shipped_demo_in_the_background(tmp_path, monkeypatch):
    from data_formulator.sites import install
    monkeypatch.setattr(install, "_jobs", {})
    monkeypatch.setattr(install, "is_local_mode", lambda: True)
    _shipped_demo(tmp_path)
    client = _app().test_client()

    before = client.get("/api/demos/shipped-demo/install").get_json()["data"]
    assert before == {"status": "not_installed", "can_install": True, "job": None}
    assert client.post("/api/demos/shipped-demo/install").get_json()["data"]["job"]["state"] in {"running", "done"}
    after = _wait_for_install(client)
    assert after["status"] == "ready" and after["job"] == {"state": "done", "error": None, "log": ["built data"]}

    (tmp_path / "content" / "fail-on-purpose").touch()
    client.post("/api/demos/shipped-demo/install")
    failed = _wait_for_install(client)
    assert failed["job"]["state"] == "failed" and failed["job"]["error"] == "download failed"
    assert failed["job"]["log"][-1] == "error: download failed"


def test_only_local_installs_of_shipped_demos_can_install(tmp_path, monkeypatch):
    from data_formulator.errors import AppError
    from data_formulator.sites import install
    monkeypatch.setattr(install, "_jobs", {})
    _shipped_demo(tmp_path)
    client = _app().test_client()

    monkeypatch.setattr(install, "is_local_mode", lambda: False)
    assert client.get("/api/demos/shipped-demo/install").get_json()["data"]["can_install"] is False
    with pytest.raises(AppError, match="local"):
        client.post("/api/demos/shipped-demo/install")
    monkeypatch.setattr(install, "is_local_mode", lambda: True)
    # "demo" has only an installed profile, no build script.
    assert client.get("/api/demos/demo/install").get_json()["data"]["can_install"] is False
    for path in ("/api/demos/demo/install", "/api/demos/missing-site/install"):
        with pytest.raises(AppError):
            client.post(path)
    assert client.post("/api/demos/..%2Fetc/install").status_code == 404
    assert install._jobs == {}


def test_the_menu_lists_installed_demos_and_installable_shipped_ones(tmp_path, monkeypatch):
    from data_formulator.sites import install
    _shipped_demo(tmp_path)
    (tmp_path / "content" / "broken").mkdir()
    (tmp_path / "content" / "broken" / "profile.yaml").write_text("- not a profile\n", encoding="utf-8")
    assert sites.all_demo_ids() == ["demo", "shipped-demo"]

    monkeypatch.setattr(install, "is_local_mode", lambda: False)
    assert install.listed_demos() == []  # neither is installed, and a hosted server cannot install
    release_dir = tmp_path / "content" / "demo" / "r1"
    release_dir.mkdir(parents=True)
    for name in ("culture.zip", "education.zip", "hero.png"):
        (release_dir / name).write_bytes(b"x")
    assert install.listed_demos() == [{"id": "demo", "name": "Demo Explorer"}]
    monkeypatch.setattr(install, "is_local_mode", lambda: True)
    assert install.listed_demos() == [{"id": "demo", "name": "Demo Explorer"}, {"id": "shipped-demo", "name": "Shipped"}]
