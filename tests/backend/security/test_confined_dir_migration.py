# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Regression tests for Phase 5 ConfinedDir migration.

Verifies that Workspace.confined_* properties, agent tool path safety,
and scratch route path safety all
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
