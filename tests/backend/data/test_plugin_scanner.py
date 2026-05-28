# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the data-loader plugin scanner.

The scanner runs at module import time, so each test sets up env vars and
plugin files first, then reloads the ``data_formulator.data_loader``
module to trigger a fresh scan.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

pytestmark = [pytest.mark.backend]


GOOD_PLUGIN = """\
from data_formulator.data_loader.external_data_loader import ExternalDataLoader


class DemoLoader(ExternalDataLoader):
    def __init__(self, params=None):
        self.params = params or {}
"""

BROKEN_IMPORT_PLUGIN = "import nonexistent_pkg_xyz_for_test  # noqa: F401\n"

NO_SUBCLASS_PLUGIN = "x = 1\n"

OVERRIDE_BUILTIN_PLUGIN = """\
from data_formulator.data_loader.external_data_loader import ExternalDataLoader


class OverrideMysql(ExternalDataLoader):
    def __init__(self, params=None):
        self.params = params or {}
"""

MULTI_CLASS_PLUGIN = """\
from data_formulator.data_loader.external_data_loader import ExternalDataLoader


class AaaLoader(ExternalDataLoader):
    def __init__(self, params=None):
        self.params = params or {}


class BbbLoader(ExternalDataLoader):
    def __init__(self, params=None):
        self.params = params or {}
"""


def _write(dir_: Path, name: str, body: str) -> Path:
    p = dir_ / name
    p.write_text(body)
    return p


def _reload_scanner():
    """Purge cached scanner state and reimport so the scan re-runs."""
    for mod_name in list(sys.modules):
        if mod_name == "data_formulator.data_loader" or mod_name.startswith("df_plugin_"):
            sys.modules.pop(mod_name, None)
    return importlib.import_module("data_formulator.data_loader")


# ── gating ────────────────────────────────────────────────────────────────


def test_scanner_disabled_in_hosted_mode(tmp_path, monkeypatch):
    """Plugin scanning is off when WORKSPACE_BACKEND != local and no opt-in."""
    _write(tmp_path, "demo_data_loader.py", GOOD_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "azure_blob")
    monkeypatch.delenv("DF_ALLOW_PLUGINS", raising=False)

    dl = _reload_scanner()

    assert dl.PLUGIN_LOADERS == {}
    assert "demo" not in dl.DATA_LOADERS


def test_scanner_enabled_in_local_mode(tmp_path, monkeypatch):
    _write(tmp_path, "demo_data_loader.py", GOOD_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert "demo" in dl.PLUGIN_LOADERS
    assert dl.PLUGIN_LOADERS["demo"].endswith("demo_data_loader.py")
    assert "demo" in dl.DATA_LOADERS
    assert dl.DATA_LOADERS["demo"].__name__ == "DemoLoader"


def test_scanner_opt_in_overrides_hosted_gate(tmp_path, monkeypatch):
    _write(tmp_path, "demo_data_loader.py", GOOD_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "azure_blob")
    monkeypatch.setenv("DF_ALLOW_PLUGINS", "1")

    dl = _reload_scanner()

    assert "demo" in dl.PLUGIN_LOADERS


# ── failure paths surface in DISABLED_LOADERS ─────────────────────────────


def test_missing_dependency_recorded_with_pip_hint(tmp_path, monkeypatch):
    _write(tmp_path, "broken_data_loader.py", BROKEN_IMPORT_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert "broken" not in dl.DATA_LOADERS
    assert "broken" not in dl.PLUGIN_LOADERS
    assert "broken" in dl.DISABLED_LOADERS
    msg = dl.DISABLED_LOADERS["broken"]
    assert "nonexistent_pkg_xyz_for_test" in msg
    assert "pip install" in msg


def test_no_subclass_recorded_in_disabled(tmp_path, monkeypatch):
    _write(tmp_path, "empty_data_loader.py", NO_SUBCLASS_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert "empty" not in dl.DATA_LOADERS
    assert "empty" in dl.DISABLED_LOADERS
    assert "no ExternalDataLoader subclass" in dl.DISABLED_LOADERS["empty"]


def test_broken_plugin_does_not_leak_sys_modules(tmp_path, monkeypatch):
    """A failed exec_module should not leave a half-initialized module behind."""
    _write(tmp_path, "broken_data_loader.py", BROKEN_IMPORT_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    _reload_scanner()

    assert "df_plugin_broken" not in sys.modules


# ── override semantics ────────────────────────────────────────────────────


def test_plugin_overriding_builtin_is_rejected(tmp_path, monkeypatch):
    """Security: a plugin keyed ``mysql`` must NOT replace the built-in.

    Silent override would let a malicious plugin capture credentials for
    every existing MySQL connection. The scanner rejects the override and
    records a structured entry in PLUGIN_ERRORS so the UI can surface it.
    """
    _write(tmp_path, "mysql_data_loader.py", OVERRIDE_BUILTIN_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    # Plugin must NOT be registered.
    assert "mysql" not in dl.PLUGIN_LOADERS
    # If the built-in is present (pymysql installed), it must remain the
    # original class — definitely not the plugin's class.
    if "mysql" in dl.DATA_LOADERS:
        assert dl.DATA_LOADERS["mysql"].__name__ != "OverrideMysql"
    # Error must surface in PLUGIN_ERRORS with the right shape.
    errors = [e for e in dl.PLUGIN_ERRORS if e["kind"] == "override_builtin"]
    assert len(errors) == 1
    assert errors[0]["file"].endswith("mysql_data_loader.py")
    assert "mysql" in errors[0]["reason"]


def test_duplicate_plugin_keys_are_rejected(tmp_path, monkeypatch):
    """Two plugins claiming the same registry key: second is rejected."""
    # Both files have prefix ``demo`` → same registry key.
    _write(tmp_path, "demo_data_loader.py", GOOD_PLUGIN)
    sub = tmp_path / "sub"
    sub.mkdir()
    # Same dir collision: write a second file that also resolves to "demo".
    second = tmp_path / "demo_data_loader.py.bak"  # won't collide
    # Instead, use the actual collision path via two distinct filenames that
    # produce the same key. Since key = filename minus "_data_loader",
    # two files cannot share a name in one dir. So this test instead
    # verifies that re-scanning twice without clearing PLUGIN_LOADERS
    # rejects the second registration. Easiest path: write the same file,
    # call _load_plugin_file twice on it manually.
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")
    dl = _reload_scanner()
    assert "demo" in dl.PLUGIN_LOADERS

    # Manually re-invoke loader on the same file → simulates collision.
    from pathlib import Path as _P
    dl._load_plugin_file(_P(tmp_path) / "demo_data_loader.py")  # type: ignore[attr-defined]
    dups = [e for e in dl.PLUGIN_ERRORS if e["kind"] == "duplicate"]
    assert len(dups) >= 1


# ── multiple subclasses ───────────────────────────────────────────────────


def test_multiple_subclasses_registers_first_alphabetically(tmp_path, monkeypatch):
    _write(tmp_path, "multi_data_loader.py", MULTI_CLASS_PLUGIN)
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert "multi" in dl.PLUGIN_LOADERS
    # inspect.getmembers returns alphabetically-sorted; AaaLoader wins.
    assert dl.DATA_LOADERS["multi"].__name__ == "AaaLoader"


# ── empty / missing plugin dir ────────────────────────────────────────────


def test_missing_plugin_dir_is_silent(tmp_path, monkeypatch):
    missing = tmp_path / "does_not_exist"
    monkeypatch.setenv("DF_PLUGIN_DIR", str(missing))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert dl.PLUGIN_LOADERS == {}


def test_empty_plugin_dir_is_silent(tmp_path, monkeypatch):
    monkeypatch.setenv("DF_PLUGIN_DIR", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert dl.PLUGIN_LOADERS == {}


# ── plugin dir resolution ─────────────────────────────────────────────────


def test_plugin_dir_defaults_to_data_formulator_home(tmp_path, monkeypatch):
    """``DATA_FORMULATOR_HOME/plugins`` is the default when DF_PLUGIN_DIR unset."""
    plugins = tmp_path / "plugins"
    plugins.mkdir()
    _write(plugins, "demo_data_loader.py", GOOD_PLUGIN)

    monkeypatch.delenv("DF_PLUGIN_DIR", raising=False)
    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert dl.PLUGIN_DIR == str(plugins)
    assert "demo" in dl.PLUGIN_LOADERS


def test_df_plugin_dir_overrides_data_formulator_home(tmp_path, monkeypatch):
    """Explicit DF_PLUGIN_DIR wins over DATA_FORMULATOR_HOME/plugins."""
    df_home = tmp_path / "home"
    (df_home / "plugins").mkdir(parents=True)
    explicit = tmp_path / "explicit"
    explicit.mkdir()
    _write(explicit, "demo_data_loader.py", GOOD_PLUGIN)

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(df_home))
    monkeypatch.setenv("DF_PLUGIN_DIR", str(explicit))
    monkeypatch.setenv("WORKSPACE_BACKEND", "local")

    dl = _reload_scanner()

    assert dl.PLUGIN_DIR == str(explicit)
    assert "demo" in dl.PLUGIN_LOADERS
