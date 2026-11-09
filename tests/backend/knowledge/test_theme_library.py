# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The user's chart theme library: validation, the store, and the agent's theme tools."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from data_formulator.analyst.session_edits import validate_chart
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.theme.skill import get_skill
from data_formulator.knowledge.themes import ThemeStore, validate_theme

pytestmark = [pytest.mark.backend]

PRESETS = ["nyt", "economist", "datawrapper", "powerbi"]
ACME = {"id": "acme", "label": "Acme", "extends": "datawrapper",
        "ink": {"series": {"single": "#14213d", "categorical": ["#14213d", "#fca311"]}}}


def test_validate_theme_accepts_a_small_override():
    assert validate_theme(ACME, PRESETS) is ACME


def test_validate_theme_lists_every_problem():
    with pytest.raises(ValueError) as error:
        validate_theme({"id": "nyt", "extends": "nope", "colors": [], "ink": {"text": {"primary": "rgb(0,0,0)", "muted": "#12"}},
                        "furniture": {}}, PRESETS)
    message = str(error.value)
    for problem in ("is a Flint preset", "label must be", "'nope' is not a Flint preset", "unknown key 'colors'",
                    "furniture must be a list", "write colors as hex", "'#12' is not a hex color"):
        assert problem in message


def test_store_saves_replaces_lists_and_deletes(tmp_path):
    store = ThemeStore(tmp_path)
    assert store.list() == []
    assert store.save(ACME, PRESETS) == (ACME, True)
    revised = {**ACME, "label": "Acme 2"}
    assert store.save(revised, PRESETS) == (revised, False)
    assert store.list() == [revised]
    assert json.loads((tmp_path / "themes" / "acme.json").read_text()) == revised
    assert store.delete("acme") is True
    assert store.delete("acme") is False
    assert store.delete("../escape") is False
    assert store.list() == []


def _ctx(tmp_path):
    return SkillContext(client=None, workspace=SimpleNamespace(user_home=tmp_path))


def test_theme_tools_save_and_list(tmp_path):
    skill = get_skill()
    saved = json.loads(skill.handle_tool("save_theme", {"theme": ACME}, _ctx(tmp_path)).text)
    assert saved["saved"] == "acme" and saved["new"] is True and saved["theme"] == ACME
    listed = json.loads(skill.handle_tool("list_themes", {}, _ctx(tmp_path)).text)
    assert "economist" in listed["presets"] and listed["saved"] == [ACME]
    rejected = json.loads(skill.handle_tool("save_theme", {"theme": {"id": "x"}}, _ctx(tmp_path)).text)
    assert rejected["error"].startswith("Theme not saved")


def test_chart_files_take_saved_theme_ids():
    previous = {"chart_type": "Bar Chart", "table": "t", "encodings": {"x": {"field": "a"}, "y": {"field": "b"}}}
    text = json.dumps({**previous, "theme": "acme"})
    with pytest.raises(ValueError, match="'acme' is not a theme"):
        validate_chart(text, previous, ["a", "b"])
    assert validate_chart(text, previous, ["a", "b"], ["acme"])["theme"] == "acme"
