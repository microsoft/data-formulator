# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Regression tests for Phase 5 ConfinedDir migration.

Verifies that Workspace.confined_* properties, agent tool path safety,
scratch route path safety, and CachedAzureBlobWorkspace._cache_path all
correctly delegate to ConfinedDir after the migration from hand-written
resolve+relative_to checks.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.datalake.workspace import Workspace
from data_formulator.security.path_safety import ConfinedDir

pytestmark = [pytest.mark.backend]


# ── Workspace confined_* properties ─────────────────────────────────────


class TestWorkspaceConfinedProperties:

    @pytest.fixture()
    def workspace(self, tmp_path):
        ws = Workspace("test-user", root_dir=tmp_path)
        yield ws
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_confined_root_is_confineddir(self, workspace):
        assert isinstance(workspace.confined_root, ConfinedDir)

    def test_confined_data_is_confineddir(self, workspace):
        assert isinstance(workspace.confined_data, ConfinedDir)

    def test_confined_scratch_is_confineddir(self, workspace):
        assert isinstance(workspace.confined_scratch, ConfinedDir)

    def test_confined_root_points_to_workspace_path(self, workspace):
        assert workspace.confined_root.root == workspace._path.resolve()

    def test_confined_data_points_to_data_subdir(self, workspace):
        assert workspace.confined_data.root == (workspace._path / "data").resolve()

    def test_confined_scratch_points_to_scratch_subdir(self, workspace):
        assert workspace.confined_scratch.root == (workspace._path / "scratch").resolve()

    def test_confined_root_rejects_traversal(self, workspace):
        with pytest.raises(ValueError):
            workspace.confined_root.resolve("../../etc/passwd")

    def test_confined_data_rejects_traversal(self, workspace):
        with pytest.raises(ValueError):
            workspace.confined_data.resolve("../secret.txt")

    def test_confined_scratch_rejects_traversal(self, workspace):
        with pytest.raises(ValueError):
            workspace.confined_scratch.resolve("../../evil.sh")

    def test_get_file_path_uses_confined_data(self, workspace):
        path = workspace.get_file_path("test.parquet")
        assert path.parent == workspace.confined_data.root

    def test_get_file_path_traversal_sanitized(self, workspace):
        # safe_data_filename strips directory components first (layer 1),
        # so "../../etc/passwd" becomes "passwd" before ConfinedDir (layer 2).
        # Both layers cooperate: the result is safely inside data/.
        path = workspace.get_file_path("../../etc/passwd")
        assert path.parent == workspace.confined_data.root

    def test_data_dir_created(self, workspace):
        assert workspace.confined_data.root.exists()

    def test_scratch_dir_created(self, workspace):
        assert workspace.confined_scratch.root.exists()


# ── Agent tool path safety (uses workspace.confined_*) ──────────────────


class _FakeWorkspace:
    """Minimal workspace stub with confined_* properties for tool tests."""
    def __init__(self, path: Path):
        self._path = path
        self._confined_root = ConfinedDir(path, mkdir=False)
        self._confined_data = ConfinedDir(path / "data")
        self._confined_scratch = ConfinedDir(path / "scratch")

    @property
    def confined_root(self):
        return self._confined_root

    @property
    def confined_data(self):
        return self._confined_data

    @property
    def confined_scratch(self):
        return self._confined_scratch


class TestAgentToolsUseConfinedProperties:

    @pytest.fixture()
    def workspace_path(self, tmp_path):
        ws = tmp_path / "workspace"
        ws.mkdir()
        data = ws / "data"
        data.mkdir()
        (data / "sales.csv").write_text("product,amount\nA,100\n")
        scratch = ws / "scratch"
        scratch.mkdir()
        (scratch / "output.csv").write_text("x,y\n1,2\n")
        return ws

    @pytest.fixture()
    def agent(self, workspace_path):
        from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent
        ws = _FakeWorkspace(workspace_path)
        a = DataLoadingAgent.__new__(DataLoadingAgent)
        a.workspace = ws
        return a

    def test_read_file_traversal_blocked(self, agent):
        result = agent._tool_read_file(
            {"path": "../../etc/passwd"},
            agent.workspace.confined_root,
        )
        assert "error" in result
        assert "Access denied" in result["error"]

    def test_write_file_traversal_blocked(self, agent):
        result = agent._tool_write_file(
            {"path": "../../evil.txt", "content": "hacked"},
            agent.workspace.confined_scratch,
        )
        written_path = agent.workspace._path / "scratch" / result["path"].split("/")[-1]
        assert written_path.parent == agent.workspace._path / "scratch"

    def test_list_directory_traversal_blocked(self, agent):
        result = agent._tool_list_directory(
            {"path": "../../"},
            agent.workspace.confined_root,
        )
        assert "error" in result

    def test_preview_scratch_traversal_blocked(self, agent, workspace_path):
        scratch_dir = workspace_path / "scratch"
        result = agent._preview_scratch_files(
            [{"path": "../../etc/passwd", "name": "evil"}],
            scratch_dir,
        )
        actions = result["actions"]
        assert len(actions) == 1
        assert "error" in actions[0]


# ── CachedAzureBlobWorkspace._cache_path uses ConfinedDir ──────────────


class TestCachedAzureBlobCachePath:

    def test_cache_path_rejects_traversal(self, tmp_path):
        from data_formulator.datalake.cached_azure_blob_workspace import (
            CachedAzureBlobWorkspace,
        )
        jail = ConfinedDir(tmp_path / "cache", mkdir=True)

        instance = CachedAzureBlobWorkspace.__new__(CachedAzureBlobWorkspace)
        instance._cache_dir = jail.root
        instance._cache_jail = jail

        with pytest.raises(ValueError):
            instance._cache_path("../../etc/passwd")

    def test_cache_path_normal_file(self, tmp_path):
        from data_formulator.datalake.cached_azure_blob_workspace import (
            CachedAzureBlobWorkspace,
        )
        cache_dir = tmp_path / "cache"
        jail = ConfinedDir(cache_dir, mkdir=True)

        instance = CachedAzureBlobWorkspace.__new__(CachedAzureBlobWorkspace)
        instance._cache_dir = jail.root
        instance._cache_jail = jail

        result = instance._cache_path("data.parquet")
        assert result == (cache_dir / "data.parquet").resolve()

    def test_cache_path_absolute_path_rejected(self, tmp_path):
        from data_formulator.datalake.cached_azure_blob_workspace import (
            CachedAzureBlobWorkspace,
        )
        jail = ConfinedDir(tmp_path / "cache", mkdir=True)

        instance = CachedAzureBlobWorkspace.__new__(CachedAzureBlobWorkspace)
        instance._cache_dir = jail.root
        instance._cache_jail = jail

        with pytest.raises(ValueError):
            instance._cache_path("/etc/passwd")


# ── Scratch routes use workspace.confined_scratch ───────────────────────


class TestScratchRoutesConfinedMigration:

    @pytest.fixture()
    def tmp_workspace(self, tmp_path):
        ws = Workspace("test-user", root_dir=tmp_path)
        (ws._path / "scratch").mkdir(exist_ok=True)
        (ws._path / "scratch" / "report.csv").write_text("a,b\n1,2\n")
        yield ws
        shutil.rmtree(tmp_path, ignore_errors=True)

    @pytest.fixture()
    def client(self, tmp_workspace):
        from flask import Flask
        from data_formulator.error_handler import register_error_handlers
        from data_formulator.routes.agents import agent_bp

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.register_blueprint(agent_bp)
        register_error_handlers(app)
        with (
            patch("data_formulator.routes.agents.get_identity_id", return_value="test-user"),
            patch("data_formulator.routes.agents.get_workspace", return_value=tmp_workspace),
        ):
            with app.test_client() as c:
                yield c

    def test_scratch_serve_normal(self, client):
        resp = client.get("/api/agent/workspace/scratch/report.csv")
        assert resp.status_code == 200
        assert b"a,b" in resp.data

    def test_scratch_serve_traversal_rejected(self, client):
        resp = client.get("/api/agent/workspace/scratch/../../../etc/passwd")
        assert resp.status_code == 403
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "ACCESS_DENIED"

    def test_scratch_serve_nonexistent(self, client):
        resp = client.get("/api/agent/workspace/scratch/no_such.csv")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "TABLE_NOT_FOUND"

    def test_scratch_upload_normal(self, client, tmp_workspace):
        import io
        data = io.BytesIO(b"col1,col2\n1,2\n")
        resp = client.post(
            "/api/agent/workspace/scratch/upload",
            data={"file": (data, "test.csv")},
            content_type="multipart/form-data",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"]["path"].startswith("scratch/")

    def test_scratch_upload_traversal_sanitized(self, client, tmp_workspace):
        import io
        data = io.BytesIO(b"evil")
        resp = client.post(
            "/api/agent/workspace/scratch/upload",
            data={"file": (data, "../../etc/passwd")},
            content_type="multipart/form-data",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        written = tmp_workspace._path / body["data"]["path"]
        assert written.parent == tmp_workspace._path / "scratch"

    def test_scratch_upload_no_file_returns_error(self, client):
        resp = client.post("/api/agent/workspace/scratch/upload")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "INVALID_REQUEST"
