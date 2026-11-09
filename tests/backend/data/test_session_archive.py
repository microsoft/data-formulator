# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The one cleaning path for shared sessions (design-docs/71)."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

import pytest

from data_formulator.datalake import workspace as workspace_module
from data_formulator.datalake.session_archive import build_session_archive, share_state
from data_formulator.datalake.workspace import Workspace

pytestmark = [pytest.mark.backend]


def _attachment_name(stem: str, content: bytes, extension: str) -> str:
    return f"{stem}_{hashlib.sha256(content).hexdigest()[:8]}{extension}"


def test_share_state_drops_credentials_server_models_and_pending_requests():
    state = {
        "models": [{"api_key": "secret"}], "selectedModelId": "m", "testedModels": [], "identity": {"id": "u"},
        "dataLoaderConnectParams": {"pg": {"password": "p"}}, "agentRules": {}, "serverConfig": {},
        "globalModels": [{"endpoint": "azure", "api_base": "https://internal.example"}],
        "analystChatPending": {"text": "draft"}, "agentHandoffRequest": {"prompt": "x"}, "connectorRefreshRequest": 3,
        "activeWorkspace": {"id": "session_1", "displayName": "Sales", "scheduledRun": {"scheduleId": "s"}},
        "charts": [{"id": "c1"}], "textTurns": [{"id": "t1"}],
    }
    assert share_state(state) == {
        "activeWorkspace": {"displayName": "Sales"}, "charts": [{"id": "c1"}], "textTurns": [{"id": "t1"}],
    }


def test_archive_keeps_session_content_and_chat_attachments_only(tmp_path):
    workspace = Workspace("user:a", root_dir=tmp_path)
    workspace.save_workspace_file(b"# Notes", "notes/plan.md", "text/markdown")
    root = workspace._path
    attachment = b"region,sales\nwest,3\n"
    attached = _attachment_name("sales", attachment, ".csv")
    pasted = _attachment_name("pasted-text-1", b"long paste", ".txt")
    (root / "scratch" / "tasks").mkdir(parents=True)
    (root / "scratch" / "_agent").mkdir()
    (root / "scratch" / attached).write_bytes(attachment)
    (root / "scratch" / pasted).write_bytes(b"long paste")
    (root / "scratch" / "download_deadbeef.json").write_bytes(b"{}")  # looks like one, but its hash differs
    (root / "scratch" / "quakes.json").write_bytes(b"[]")
    (root / "scratch" / "tasks" / "task-1.log").write_text("token=abc")
    (root / "scratch" / "_agent" / "history.json").write_text("[]")
    (root / "scratch" / ".workspace.lock").write_text("")
    (root / "session_state.json").write_text("{}")
    (root / "workspace_meta.json").write_text("{}")
    (root / "memory").mkdir(exist_ok=True)
    (root / "memory" / "glossary.md").write_text("terms")

    archive = build_session_archive(workspace, {"globalModels": [1], "activeWorkspace": {"id": "x", "displayName": "S"}})
    with zipfile.ZipFile(archive) as zf:
        names = set(zf.namelist())
        state = json.loads(zf.read("state.json"))

    assert state == {"activeWorkspace": {"displayName": "S"}}
    assert f"workspace/scratch/{attached}" in names
    assert f"workspace/scratch/{pasted}" in names
    assert "workspace/memory/glossary.md" in names
    assert {"workspace/files/notes/plan.md", "workspace/workspace.yaml"} <= names
    leaked = {name for name in names if name.startswith("workspace/scratch/") and attached not in name and pasted not in name}
    assert leaked == set()
    assert not names & {"workspace/session_state.json", "workspace/workspace_meta.json"}
    assert not any(name.endswith(".workspace.lock") for name in names)


def test_archive_round_trips_into_another_workspace(tmp_path):
    source = Workspace("user:a", root_dir=tmp_path / "a")
    source.save_workspace_file(b"# Guide", "guide.md", "text/markdown")
    archive = build_session_archive(source, {"charts": []})

    target = Workspace("user:b", root_dir=tmp_path / "b")
    assert target.import_session_zip(archive) == {"charts": []}
    assert target.read_workspace_file("guide.md")[1] == b"# Guide"


def test_import_refuses_oversized_archives(tmp_path, monkeypatch):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("state.json", "{}")
        for index in range(5):
            zf.writestr(f"workspace/files/{index}.txt", "x" * 100)
    workspace = Workspace("user:a", root_dir=tmp_path)

    monkeypatch.setattr(workspace_module, "MAX_SESSION_ARCHIVE_ENTRIES", 3)
    archive.seek(0)
    with pytest.raises(ValueError, match="too large"):
        workspace.import_session_zip(archive)

    monkeypatch.setattr(workspace_module, "MAX_SESSION_ARCHIVE_ENTRIES", 100)
    monkeypatch.setattr(workspace_module, "MAX_SESSION_ARCHIVE_BYTES", 200)
    archive.seek(0)
    with pytest.raises(ValueError, match="too large"):
        workspace.import_session_zip(archive)
