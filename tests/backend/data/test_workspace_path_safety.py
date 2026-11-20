# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Security tests for Workspace path traversal checks (FINDING-4)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from data_formulator.datalake.workspace import Workspace

pytestmark = [pytest.mark.backend]


class TestWorkspacePathTraversal:

    def test_normal_identity_succeeds(self, tmp_path):
        ws = Workspace("alice", root_dir=tmp_path)
        assert ws._path.exists()
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_dotdot_identity_sanitized_safely(self, tmp_path):
        """'../admin' is sanitized to 'admin' by secure_filename — no traversal."""
        ws = Workspace("../admin", root_dir=tmp_path)
        assert ws._path.resolve().is_relative_to(tmp_path.resolve())
        assert ".." not in ws._path.parts
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_slash_identity_sanitized_safely(self, tmp_path):
        """'alice/../../root' is sanitized to 'alice_.._.._root' — no traversal."""
        ws = Workspace("alice/../../root", root_dir=tmp_path)
        assert ws._path.resolve().is_relative_to(tmp_path.resolve())
        assert ".." not in ws._path.parts
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_empty_identity_rejected(self, tmp_path):
        with pytest.raises(ValueError):
            Workspace("", root_dir=tmp_path)

    def test_path_must_be_under_root(self, tmp_path):
        """The workspace path must be strictly under root (not equal to root)."""
        root = tmp_path / "workspaces"
        root.mkdir()
        with pytest.raises(ValueError):
            Workspace(".", root_dir=root)


# ---------------------------------------------------------------------------
# Session ZIP import keeps workspace file names (and still refuses traversal)
# ---------------------------------------------------------------------------

def test_session_zip_round_trip_keeps_file_names_with_spaces(tmp_path):
    import io
    import zipfile

    from data_formulator.datalake.workspace import Workspace

    source = Workspace("user:a", root_dir=tmp_path / "a")
    source.save_workspace_file(b"# Guide", "UIS data guide.md", "text/markdown")
    source.save_workspace_file(b"# Readme", "docs/DEM README.md", "text/markdown")
    archive = source.export_session_zip({"activeWorkspace": {"id": "x"}})

    target = Workspace("user:b", root_dir=tmp_path / "b")
    target.import_session_zip(archive)
    assert target.read_workspace_file("UIS data guide.md")[1] == b"# Guide"
    assert target.read_workspace_file("docs/DEM README.md")[1] == b"# Readme"

    hostile = io.BytesIO()
    with zipfile.ZipFile(hostile, "w") as zf:
        zf.writestr("state.json", "{}")
        zf.writestr("workspace/../../escaped.txt", "x")
        zf.writestr("workspace/files/..\\..\\escaped2.txt", "x")
    hostile.seek(0)
    victim = Workspace("user:c", root_dir=tmp_path / "c")
    victim.import_session_zip(hostile)
    escaped = list(tmp_path.rglob("escaped*.txt"))
    # Nothing lands outside the importing workspace; unsafe components are dropped or sanitized.
    assert escaped and all(path.resolve().is_relative_to((tmp_path / "c").resolve()) for path in escaped)


def test_opening_a_workspace_restores_file_names_an_older_import_sanitized(tmp_path):
    from data_formulator.datalake.workspace_manager import WorkspaceManager

    manager = WorkspaceManager(tmp_path / "workspaces")
    workspace = manager.create_and_open_workspace("session", "user:a")
    workspace.save_workspace_file(b"# Guide", "UIS data guide.md", "text/markdown")
    workspace.save_workspace_file(b"# Readme", "docs/DEM README.md", "text/markdown")
    files = tmp_path / "workspaces" / "session" / "files"
    (files / "UIS data guide.md").rename(files / "UIS_data_guide.md")
    (files / "docs" / "DEM README.md").rename(files / "docs" / "DEM_README.md")

    reopened = manager.open_workspace("session", "user:a")
    assert reopened.read_workspace_file("UIS data guide.md")[1] == b"# Guide"
    assert reopened.read_workspace_file("docs/DEM README.md")[1] == b"# Readme"
    assert not (files / "UIS_data_guide.md").exists()
    assert reopened.repair_legacy_file_names() == 0
