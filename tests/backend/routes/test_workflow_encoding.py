"""Workflow checkpoints and message inboxes are written as UTF-8, so they must be read back as UTF-8.

On Windows the default text encoding is the locale code page (e.g. cp1252), so a bare
``Path.read_text()`` either raises ``UnicodeDecodeError`` or returns mojibake for non-ASCII text.
The fixture below makes that default deterministic on every platform.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from data_formulator.routes import sessions as sessions_routes
from data_formulator.routes import workflows as workflow_routes
from data_formulator.routes.workflows import read_messages, save_run

pytestmark = [pytest.mark.backend]

NON_ASCII = "データ分析 ✅ café"


@pytest.fixture()
def legacy_locale_default(monkeypatch):
    """Make ``Path.read_text()`` without an explicit encoding behave as on a cp1252 Windows locale."""
    original = Path.read_text

    def read_text(self, encoding=None, errors=None, *args, **kwargs):
        return original(self, "cp1252" if encoding is None else encoding, errors, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_text)


def test_read_messages_returns_utf8_inbox_intact(tmp_path, legacy_locale_default):
    path = tmp_path / "run.json"
    path.with_suffix(".messages").write_text(
        json.dumps([{"id": "m1", "text": NON_ASCII}], ensure_ascii=False), encoding="utf-8")

    assert read_messages(path) == [{"id": "m1", "text": NON_ASCII}]


def test_scheduled_checkpoint_reads_saved_non_ascii_run(tmp_path, monkeypatch, legacy_locale_default):
    path = tmp_path / "run.json"
    state = {"status": "running", "instance": {"name": NON_ASCII, "steps": []}}
    save_run(path, state)
    monkeypatch.setattr(workflow_routes, "run_path", lambda workspace, identifier: path)
    manager = SimpleNamespace(open_workspace=lambda workspace_id, identity_id: object())

    checkpoint = sessions_routes.scheduled_checkpoint(manager, "scheduled-run", "user")

    assert checkpoint is not None
    assert checkpoint["instance"]["name"] == NON_ASCII


def test_workflow_agent_loads_tool_schemas_with_non_ascii_descriptions(legacy_locale_default):
    """visualization/tools.json carries a non-ASCII description that the agent reads at import time."""
    source = Path(importlib.util.find_spec("data_formulator.workflows.agent").origin)
    spec = importlib.util.spec_from_file_location("_workflow_agent_encoding_probe", source)
    module = importlib.util.module_from_spec(spec)

    spec.loader.exec_module(module)

    schema = next(item for item in module.TOOLS if item["function"]["name"] == "visualize")
    assert "≤12 words" in json.dumps(schema, ensure_ascii=False)
