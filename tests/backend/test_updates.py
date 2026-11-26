from __future__ import annotations

import sys

import pytest

from data_formulator import updates

pytestmark = [pytest.mark.backend]


class _Response:
    def __init__(self, data):
        self.data = data

    def json(self):
        return self.data


def _serve(monkeypatch, data, *, kind, current):
    import requests
    monkeypatch.setattr(updates, "_cache", None)
    monkeypatch.setattr(updates, "install_kind", lambda: kind)
    monkeypatch.setattr(updates, "current_version", lambda: current)
    monkeypatch.setattr(requests, "get", lambda url, **_: _Response(data[url]) if not isinstance(data[url], Exception)
                        else (_ for _ in ()).throw(data[url]))


def test_the_desktop_app_is_offered_the_newer_github_release_for_its_platform(monkeypatch) -> None:
    monkeypatch.setattr(sys, "platform", "darwin")
    _serve(monkeypatch, {updates.GITHUB_LATEST: {"tag_name": "0.9", "html_url": "https://github.com/r/0.9", "assets": [
        {"name": "Data-Formulator-Windows-x64.zip", "browser_download_url": "https://dl/win.zip"},
        {"name": "Data-Formulator-macOS.zip", "browser_download_url": "https://dl/mac.zip"}]}}, kind="desktop", current="0.8.0b1")

    assert updates.check() == {"current": "0.8.0b1", "kind": "desktop", "update_available": True, "latest": "0.9",
                               "url": "https://github.com/r/0.9", "download_url": "https://dl/mac.zip"}


def test_the_same_release_written_differently_is_no_update(monkeypatch) -> None:
    _serve(monkeypatch, {updates.GITHUB_LATEST: {"tag_name": "0.8b1", "assets": []}}, kind="desktop", current="0.8.0b1")
    assert updates.check()["update_available"] is False


def test_a_pip_install_is_offered_final_releases_unless_it_runs_a_prerelease(monkeypatch) -> None:
    pypi = {updates.PYPI_PROJECT: {"releases": {"0.8.0": [{"yanked": False}], "0.9.0b1": [{"yanked": False}],
                                                "0.9.0": [{"yanked": True}], "0.7.0": [{"yanked": False}]}}}
    _serve(monkeypatch, pypi, kind="pip", current="0.7.0")
    assert updates.check() == {"current": "0.7.0", "kind": "pip", "update_available": True, "latest": "0.8.0",
                               "url": "https://pypi.org/project/data_formulator/0.8.0/", "command": "pip install -U data_formulator"}
    _serve(monkeypatch, pypi, kind="uv-tool", current="0.8.0b1")
    assert updates.check()["latest"] == "0.9.0b1" and updates.check()["command"] == "uv tool upgrade data_formulator"


def test_source_checkouts_offline_checks_and_the_opt_out_offer_nothing(monkeypatch) -> None:
    _serve(monkeypatch, {updates.PYPI_PROJECT: OSError("offline")}, kind="pip", current="0.7.0")
    assert updates.check()["update_available"] is False
    _serve(monkeypatch, {}, kind="source", current="0.7.0")
    assert updates.check() == {"current": "0.7.0", "kind": "source", "update_available": False}
    _serve(monkeypatch, {}, kind="pip", current="0.7.0")
    monkeypatch.setenv("DF_UPDATE_CHECK", "off")
    assert updates.check()["update_available"] is False
