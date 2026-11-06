# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The agent's browser: settings, the service over a driver, the skill's per-site approval, and the routes."""

from __future__ import annotations

import csv
import io
import json
from unittest.mock import patch

import flask
import pytest

from data_formulator.browser import service as browser_service
from data_formulator.browser.base import BrowserDriver, BrowserError
from data_formulator.browser.page_scripts import as_function_body, read_script

LOCAL = {"Origin": "http://localhost", "X-Workspace-Id": "workspace"}
HEADERS = {"Origin": "http://localhost", "X-DF-Configuration": "1"}


class FakeDriver(BrowserDriver):
    """Pages are dicts; a script is answered by the page's canned state, read or value."""

    label = "Fake Browser"
    uses_user_profile = True

    def __init__(self, pages: dict[str, dict] | None = None, positional: bool = False) -> None:
        self.pages = pages or {}
        self.positional_tabs = positional
        self.tabs: dict = {}
        self.focused: list = []
        self.opened = 0

    def probe(self):
        return [{"step": "installed", "ok": True}, {"step": "automation", "ok": True}, {"step": "javascript", "ok": True}]

    def open(self, url, tab=None, *, selector=None, timeout=30, settle=2):
        if tab is None:
            self.opened += 1
            tab = len(self.tabs) + 1 if self.positional_tabs else f"native-{self.opened}"
        self.tabs[tab] = url
        return {"tab": tab, "url": self.pages.get(url, {}).get("url", url), "title": "Page"}

    def evaluate(self, tab, body, *, timeout=30):
        if tab not in self.tabs:
            raise BrowserError("That tab was closed.", "gone")
        page = self.pages.get(self.tabs[tab], {})
        if "excerpt:" in body:
            value = {"url": page.get("url", self.tabs[tab]), "title": "Page", "signals": page.get("signals", []),
                     "text_length": page.get("text_length", 5000), "tables": 1, "links": 3, "excerpt": "Hello"}
        elif "const MODE" in body:
            mode = json.loads(body.split("const MODE = ", 1)[1].split(",", 1)[0])
            value = {"url": self.tabs[tab], "title": "Page", "mode": mode, "content": page.get(mode)}
        else:
            value = page.get("value")
        return {"value": value, "url": self.tabs[tab], "title": "Page"}

    def wait(self, tab, *, selector=None, timeout=30, settle=2):
        return {"timed_out": False}

    def info(self, tab):
        if tab not in self.tabs:
            raise BrowserError("That tab was closed.", "gone")
        return {"url": self.tabs[tab], "title": "Page"}

    def list_tabs(self):
        return [{"tab": tab, "url": url, "title": "Page"} for tab, url in self.tabs.items()]

    def focus(self, tab):
        self.focused.append(tab)

    def close(self, tab):
        self.tabs.pop(tab, None)


@pytest.fixture(autouse=True)
def browser_home(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.configuration.user_connectors_disabled", lambda: False)
    monkeypatch.setattr("data_formulator.analyst.skills.browser.skill._allowances", {})
    browser_service._service = None
    browser_service._last_check = None
    yield
    browser_service._service = None
    browser_service._last_check = None


def save(**overrides) -> None:
    from data_formulator.configuration import read_configuration, save_configuration

    current = read_configuration()
    save_configuration({**current["overrides"], **overrides}, current["revision"])


def use_driver(driver: FakeDriver, choice: str = "auto") -> browser_service.BrowserService:
    service = browser_service.BrowserService(driver, choice)
    browser_service._service = service
    return service


# -- settings -------------------------------------------------------------------------------------------

def test_browser_is_off_until_the_user_opts_in_and_shares_the_tools_mode(monkeypatch):
    from data_formulator.configuration import browser_mode

    assert browser_mode() == "off"
    save(browser_enabled=True)
    assert browser_mode() == "ask"
    save(terminal_mode="auto")
    assert browser_mode() == "auto"
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: False)
    assert browser_mode() == "off"


@pytest.mark.parametrize("overrides", [{"browser_enabled": "yes"}, {"browser_name": "firefox"},
                                       {"browser_allowed_sites": ["Example.com"]}, {"browser_allowed_sites": "example.com"}])
def test_invalid_browser_settings_are_refused(overrides):
    from data_formulator.configuration import validate_overrides

    with pytest.raises(ValueError):
        validate_overrides(overrides)


# -- page scripts and results ---------------------------------------------------------------------------

@pytest.mark.parametrize("code,expected", [
    ("document.title", "return (document.title);"),
    ("[...document.links].length;", "return ([...document.links].length);"),
    ("const x = 1;\nreturn x", "const x = 1;\nreturn x"),
    ("await sleep(1); return 2", "await sleep(1); return 2"),
    ("throw new Error('x')", "throw new Error('x')"),
])
def test_agent_code_becomes_an_async_function_body(code, expected):
    assert as_function_body(code) == expected


def test_read_script_takes_only_known_modes():
    assert '"tables"' in read_script("tables")
    with pytest.raises(ValueError):
        read_script("pdf")


@pytest.mark.parametrize("url", ["file:///etc/passwd", "javascript:alert(1)", "edge://settings", "", "http://localhost:5000/api/x"])
def test_only_web_addresses_outside_data_formulator_open(url, monkeypatch):
    monkeypatch.setattr("data_formulator.analyst.skills.terminal.skill.protected_ports", lambda: [5000])
    with pytest.raises(BrowserError):
        browser_service.check_url(url)


@pytest.mark.parametrize("state,expected", [
    ({"url": "https://login.microsoftonline.com/x", "signals": []}, "login"),
    ({"url": "https://example.com/account", "signals": ["password_field"]}, "login"),
    ({"url": "https://example.com/users/sign_in", "signals": [], "text_length": 800}, "login"),
    ({"url": "https://example.com/blog/signin-tips", "signals": [], "text_length": 20000}, None),
    ({"url": "https://example.com", "signals": ["captcha"]}, "captcha"),
    ({"url": "https://example.com/data", "signals": [], "text_length": 9000}, None),
])
def test_pages_that_wait_for_a_person_are_recognized(state, expected):
    assert browser_service.needs_person(state) == expected


def test_tables_save_as_csv_with_merged_or_inferred_headers(tmp_path):
    value = {"url": "https://stats.example.gov/t1", "title": "T", "mode": "tables", "content": [
        {"rows": [["Status", "2025", "2025"], ["Status", "Aug", "Sept"], ["Employed", "1,000", "1,020"]], "header_rows": 2},
        {"rows": [["Date", "Close", "Volume"], ["11/03/2026", "$331.90", "63,160,030"]], "header_rows": 0},
        {"rows": [["", ""], ["x", ""]], "header_rows": 0},
    ]}
    observation, display = browser_service.summarize_read(value, "t1", tmp_path)
    assert [file["path"].rsplit("-", 1)[-1] for file in display["files"]] == ["table1.csv", "table2.csv"]
    read = lambda file: list(csv.reader(io.StringIO((tmp_path / file["path"].removeprefix("scratch/")).read_text())))
    assert read(display["files"][0]) == [["Status", "2025 / Aug", "2025 / Sept"], ["Employed", "1,000", "1,020"]]
    second = read(display["files"][1])
    assert second[0] == ["Date", "Close", "Volume"] and len(second) == 2
    assert "1 rows × 3 columns" in observation


def test_long_text_is_saved_and_only_an_opening_is_shown(tmp_path):
    text = "word " * 5000
    observation, display = browser_service.summarize_read(
        {"url": "https://example.com", "title": "T", "mode": "markdown", "content": text}, "t1", tmp_path)
    assert display["files"][0]["path"].endswith(".md") and len(observation) < 4000


# -- the service over a driver --------------------------------------------------------------------------

def test_service_names_tabs_and_brings_a_sign_in_page_forward():
    driver = FakeDriver({"https://example.com/private": {"url": "https://example.com/login", "signals": ["password_field"]}})
    service = browser_service.BrowserService(driver, "auto")
    page = service.open("https://example.com/private")
    assert page["tab"] == "t1" and page["needs_user"] == "login" and driver.focused == ["native-1"]
    assert "df-browser://tab/t1" in browser_service.describe_page(page)
    assert service.site("t1") == "example.com"


def test_closing_a_positional_tab_renumbers_the_ones_after_it():
    service = browser_service.BrowserService(FakeDriver(positional=True), "safari")
    for url in ("https://a.example", "https://b.example", "https://c.example"):
        service.open(url)
    service.close("t1")
    assert service.tabs["t2"]["handle"] == 1 and service.tabs["t3"]["handle"] == 2


def test_a_closed_tab_is_forgotten():
    driver = FakeDriver()
    service = browser_service.BrowserService(driver, "auto")
    service.open("https://example.com")
    driver.tabs.clear()
    with pytest.raises(BrowserError):
        service.evaluate("t1", "1 + 1")
    assert "t1" not in service.tabs


# -- the skill: per-site approval ------------------------------------------------------------------------

def run_action(skill, action, spec, tmp_path, app):
    from data_formulator.analyst.skills.base import SkillContext
    from data_formulator.datalake.workspace import Workspace

    events = []
    with (patch("data_formulator.auth.identity.get_identity_id", return_value="local:me"),
          patch("data_formulator.workspace_factory.get_active_workspace_id", return_value="workspace"),
          app.test_request_context(headers=LOCAL, environ_base={"REMOTE_ADDR": "127.0.0.1"})):
        generator = skill.handle_action(action, spec, SkillContext(
            client=None, workspace=Workspace("w", root_dir=tmp_path),
            payload={"conversation_id": "chat", "action_narration": "Reading GDP"}))
        try:
            while True:
                events.append(next(generator))
        except StopIteration as done:
            return events, done.value


@pytest.mark.parametrize("mode,allowed,asks", [("ask", [], True), ("ask", ["example.com"], False), ("auto", [], False)])
def test_open_asks_for_sites_the_user_has_not_allowed(tmp_path, mode, allowed, asks):
    from data_formulator.analyst.skills.browser.skill import BrowserSkill

    save(browser_enabled=True, terminal_mode=mode, browser_allowed_sites=allowed)
    use_driver(FakeDriver())
    app = flask.Flask(__name__)
    events, observation = run_action(BrowserSkill(), "browser_open", {"url": "https://data.example.com/gdp"}, tmp_path, app)
    if asks:
        assert [event["type"] for event in events] == ["interact"] and observation is None
        request = events[0]["mcp_request"]
        assert request["kind"] == "browser" and request["site"] == "data.example.com" and request["purpose"] == "Reading GDP"
        assert request["id"] in app.extensions["mcp_requests"]._pending
    else:
        assert [event["type"] for event in events] == ["mcp_started", "mcp_result"]
        assert "Tab t1" in observation and events[1]["result"]["tab"] == "t1"


def test_the_browser_is_refused_when_off(tmp_path):
    from data_formulator.analyst.skills.browser.skill import BrowserSkill

    events, observation = run_action(BrowserSkill(), "browser_open", {"url": "https://example.com"}, tmp_path, flask.Flask(__name__))
    assert events == [] and "turned off" in observation


@pytest.mark.parametrize("decision", ["approve", "always", "reject"])
def test_resuming_an_approval_allows_the_site_for_the_chat_or_always(tmp_path, decision):
    from data_formulator.analyst.skills.browser.skill import resume_browser_call, site_allowed
    from data_formulator.configuration import browser_allowed_sites

    save(browser_enabled=True)
    use_driver(FakeDriver())
    proposal = {"kind": "browser", "tool": "browser_open", "site": "example.com", "title": "Open example.com",
                "arguments": {"url": "https://example.com"}}
    display, observation = resume_browser_call(proposal, decision, owner="local:me", conversation="chat", scratch_root=tmp_path)
    if decision == "reject":
        assert display["rejected"] and "Do not retry" in observation
        assert not site_allowed("local:me", "chat", "example.com")
    else:
        assert display["tab"] == "t1"
        assert site_allowed("local:me", "chat", "www.example.com") and not site_allowed("local:me", "other", "evil.com")
        assert site_allowed("local:me", "other", "example.com") is (decision == "always")
        assert browser_allowed_sites() == (["example.com"] if decision == "always" else [])


def test_registry_shows_the_skill_only_when_on():
    from data_formulator.analyst.skills import build_registry

    registry = build_registry()
    assert "browser" not in registry.with_browser_policy("off").metas
    on = registry.with_browser_policy("ask")
    assert on.metas["browser"].action_names == ("browser_open", "browser_read", "browser_eval")
    assert any("pauses for their approval" in spec["function"]["description"] for spec in on.tool_specs["browser"])


# -- routes ---------------------------------------------------------------------------------------------

@pytest.fixture
def client():
    from data_formulator.error_handler import register_error_handlers
    from data_formulator.routes.browser import browser_bp

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(browser_bp)
    register_error_handlers(app)
    with patch("data_formulator.routes.browser.get_identity_id", return_value="local:me"):
        yield app.test_client()


def test_settings_turn_on_check_open_and_focus(client):
    driver = FakeDriver()
    with patch.object(browser_service, "pick_driver", return_value=driver):
        status = client.get("/api/browser").get_json()["data"]
        assert status["enabled"] is False and status["available"] is True
        status = client.put("/api/browser", json={"enabled": True, "browser": "edge", "revision": status["revision"]},
                            headers=HEADERS).get_json()["data"]
        assert status["enabled"] and status["choice"] == "edge" and status["label"] == "Fake Browser"
        checked = client.post("/api/browser/check", json={}, headers={"Origin": "http://localhost"}).get_json()["data"]
        assert checked["ready"] is True and [step["step"] for step in checked["steps"]] == ["installed", "automation", "javascript"]
        opened = client.post("/api/browser/open", json={"url": "https://example.com"},
                             headers={"Origin": "http://localhost"}).get_json()["data"]
        assert client.post("/api/browser/focus", json={"tab": opened["tab"]}, headers={"Origin": "http://localhost"}).status_code == 200
        assert driver.focused[-1] == "native-1"


@pytest.mark.parametrize("headers", [{"X-DF-Configuration": "1"}, {"Origin": "http://evil.example", "X-DF-Configuration": "1"},
                                     {"Origin": "http://localhost"}])
def test_settings_changes_need_the_local_app(client, headers):
    response = client.put("/api/browser", json={"enabled": True, "revision": 0}, headers=headers)
    assert response.status_code >= 400


def test_a_failed_check_keeps_the_browser_off_until_a_check_passes(client):
    from data_formulator.configuration import browser_mode

    class BlockedDriver(FakeDriver):
        ok = False

        def probe(self):
            return [{"step": "installed", "ok": True}, {"step": "automation", "ok": True},
                    {"step": "javascript", "ok": self.ok, "detail": None if self.ok else "Safari does not allow JavaScript."}]

    driver = BlockedDriver()
    save(browser_enabled=True)
    with patch.object(browser_service, "pick_driver", return_value=driver):
        assert browser_mode() == "ask"
        checked = client.post("/api/browser/check", json={}, headers={"Origin": "http://localhost"}).get_json()["data"]
        assert checked["ready"] is False and checked["mode"] == "off" and checked["enabled"] is True
        assert browser_mode() == "off"
        # The failed steps come back without another check, e.g. when the Tools dialog opens again.
        status = client.get("/api/browser").get_json()["data"]
        assert status["ready"] is False and status["steps"][-1]["ok"] is False

        driver.ok = True
        checked = client.post("/api/browser/check", json={}, headers={"Origin": "http://localhost"}).get_json()["data"]
        assert checked["ready"] is True and checked["mode"] == "ask"
        assert browser_mode() == "ask"


def test_app_version_reads_the_bundle_info_plist(tmp_path, monkeypatch):
    import plistlib
    from pathlib import Path
    from data_formulator.browser.applescript import app_version

    contents = tmp_path / "Applications" / "Fake Browser.app" / "Contents"
    contents.mkdir(parents=True)
    (contents / "Info.plist").write_bytes(plistlib.dumps({"CFBundleShortVersionString": "16.6"}))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

    assert app_version("Fake Browser") == "16.6"
    assert app_version("Missing Browser") is None
