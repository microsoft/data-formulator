# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Security tests for scratch_serve — path traversal and access control."""

from __future__ import annotations

import io
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
from data_formulator.error_handler import register_error_handlers
from data_formulator.routes.agents import agent_bp

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def tmp_workspace(tmp_path):
    ws = Workspace("test-user", root_dir=tmp_path)
    scratch = ws._path / "scratch"
    scratch.mkdir(exist_ok=True)
    (scratch / "report.csv").write_text("a,b\n1,2\n")
    yield ws
    shutil.rmtree(tmp_path, ignore_errors=True)


@pytest.fixture()
def client(tmp_workspace):
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


class TestScratchServePathSafety:

    def test_normal_file_served(self, client):
        resp = client.get("/api/agent/workspace/scratch/report.csv")
        assert resp.status_code == 200
        assert b"a,b" in resp.data

    def test_path_traversal_returns_error(self, client):
        resp = client.get("/api/agent/workspace/scratch/../../../etc/passwd")
        assert resp.status_code == 403
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "ACCESS_DENIED"

    def test_dotdot_single_returns_error(self, client):
        resp = client.get("/api/agent/workspace/scratch/../secret.txt")
        assert resp.status_code == 403
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "ACCESS_DENIED"

    def test_nonexistent_file_returns_error(self, client):
        resp = client.get("/api/agent/workspace/scratch/no_such_file.csv")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "TABLE_NOT_FOUND"

    def test_response_uses_send_file_not_send_from_directory(self, client):
        """After FINDING-1 fix, scratch_serve must use send_file (not send_from_directory)."""
        with patch("flask.send_file", wraps=__import__("flask").send_file) as mock_sf:
            resp = client.get("/api/agent/workspace/scratch/report.csv")
            assert resp.status_code == 200
            mock_sf.assert_called_once()
