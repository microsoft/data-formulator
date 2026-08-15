from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills import build_registry

pytestmark = pytest.mark.backend


def _skill():
    skill = build_registry().get_skill("data-loading")
    assert skill is not None
    return skill


class _Loader:
    DISPLAY_NAME = "PostgreSQL"
    DESCRIPTION = "Query PostgreSQL databases."

    @staticmethod
    def auth_mode():
        return "credentials"

    @staticmethod
    def auth_paths():
        return []

    @staticmethod
    def auth_instructions():
        return "Enter database credentials."

    @staticmethod
    def list_params():
        return [
            {"name": "host", "required": True, "tier": "connection"},
            {"name": "password", "required": True, "tier": "auth", "sensitive": True},
        ]


class _LocalFolderLoader(_Loader):
    DISPLAY_NAME = "Local Folder"
    DESCRIPTION = "Browse files in a local directory."


def _context() -> SkillContext:
    return SkillContext(client=None, workspace=SimpleNamespace(), payload={})


def test_list_and_describe_connectors() -> None:
    skill = _skill()
    ctx = _context()
    with (
        patch.dict("data_formulator.data_loader.DATA_LOADERS", {"postgresql": _Loader}, clear=True),
        patch.dict("data_formulator.data_loader.DISABLED_LOADERS", {}, clear=True),
    ):
        listed = json.loads(skill.handle_tool("list_connectors", {}, ctx).text)
        described = json.loads(skill.handle_tool(
            "describe_connector", {"source_type": "postgresql"}, ctx,
        ).text)

    assert listed["connectors"][0]["type"] == "postgresql"
    assert "call propose_connection now" in listed["next_action"]
    assert described["params"][1]["sensitive"] is True
    assert "Call propose_connection now" in described["next_action"]


def test_propose_connection_requires_listing_first() -> None:
    skill = _skill()
    ctx = _context()
    with patch.dict("data_formulator.data_loader.DATA_LOADERS", {"postgresql": _Loader}, clear=True):
        events = list(skill.handle_action(
            "propose_connection", {"source_type": "postgresql"}, ctx,
        ))

    assert events[0]["type"] == "error"
    assert "list_connectors" in events[0]["message"]


def test_propose_connection_emits_prefilled_canvas_form_without_echo() -> None:
    skill = _skill()
    ctx = _context()
    with (
        patch.dict("data_formulator.data_loader.DATA_LOADERS", {"postgresql": _Loader}, clear=True),
        patch.dict("data_formulator.data_loader.DISABLED_LOADERS", {}, clear=True),
    ):
        skill.handle_tool("list_connectors", {}, ctx)
        events = list(skill.handle_action("propose_connection", {
            "source_type": "postgresql",
            "prefilled": {"host": "db.example.com", "password": "secret", "empty": ""},
        }, ctx))

    assert events == [{
        "type": "interact",
        "thought": "",
        "form": {
            "kind": "connector",
            "title": "Connect to PostgreSQL",
            "response": "Complete the PostgreSQL connection form to add this data source.",
            "connector": {
                "source_type": "postgresql",
                "prefilled": {"host": "db.example.com", "password": "secret"},
            },
        },
    }]
    assert "secret" not in json.dumps({key: value for key, value in events[0].items() if key != "form"})


def test_local_folder_is_available_when_registered() -> None:
    skill = _skill()
    ctx = _context()
    with (
        patch.dict("data_formulator.data_loader.DATA_LOADERS", {"local_folder": _LocalFolderLoader}, clear=True),
        patch.dict("data_formulator.data_loader.DISABLED_LOADERS", {}, clear=True),
    ):
        listed = json.loads(skill.handle_tool("list_connectors", {}, ctx).text)
        events = list(skill.handle_action("propose_connection", {
            "source_type": "local_folder",
        }, ctx))

    assert [connector["type"] for connector in listed["connectors"]] == ["local_folder"]
    assert events[0]["form"]["connector"]["source_type"] == "local_folder"