"""Unit tests for session migration/cleanup routes."""

from __future__ import annotations

import errno
from pathlib import Path
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.routes.sessions import session_bp

pytestmark = [pytest.mark.backend]


@pytest.fixture
def app():
    from data_formulator.error_handler import register_error_handlers

    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.register_blueprint(session_bp)
    register_error_handlers(_app)
    return _app


@pytest.fixture
def client(app):
    return app.test_client()


class TestSaveSessionRoute:
    def test_save_session_reports_storage_full(self, client):
        manager = MagicMock()
        manager.workspace_exists.return_value = True
        manager.save_session_state.side_effect = OSError(errno.ENOSPC, "No space left on device")

        with (
            patch("data_formulator.routes.sessions.get_identity_id", return_value="browser:abc"),
            patch("data_formulator.routes.sessions.get_workspace_manager", return_value=manager),
        ):
            resp = client.post(
                "/api/sessions/save",
                json={"id": "ws-1", "state": {"tables": []}},
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "STORAGE_FULL"
        assert body["error"]["retry"] is True
        assert "No space left on device" not in body["error"]["message"]


class TestMigrateRoute:
    def test_migrate_moves_and_cleans_source(self, client):
        source_mgr = MagicMock()
        source_mgr.root = Path("/tmp/src")
        source_mgr.delete_all_workspaces.return_value = 2

        target_mgr = MagicMock()
        target_mgr.move_workspaces_from.return_value = ["ws_a", "ws_b"]

        with (
            patch("data_formulator.routes.sessions.get_identity_id", return_value="user:alice"),
            patch(
                "data_formulator.routes.sessions.get_workspace_manager",
                side_effect=[source_mgr, target_mgr],
            ),
        ):
            resp = client.post(
                "/api/sessions/migrate",
                json={"source_identity": "browser:xyz"},
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["data"]["moved"] == ["ws_a", "ws_b"]
        target_mgr.move_workspaces_from.assert_called_once_with(source_mgr.root)
        source_mgr.delete_all_workspaces.assert_called_once()

    def test_migrate_rejects_non_user(self, client):
        with patch("data_formulator.routes.sessions.get_identity_id", return_value="browser:abc"):
            resp = client.post(
                "/api/sessions/migrate",
                json={"source_identity": "browser:xyz"},
            )

        assert resp.status_code == 403
        assert resp.get_json()["status"] == "error"


class TestCleanupAnonymousRoute:
    def test_cleanup_success(self, client):
        source_mgr = MagicMock()
        source_mgr.delete_all_workspaces.return_value = 3

        with (
            patch("data_formulator.routes.sessions.get_identity_id", return_value="user:alice"),
            patch("data_formulator.routes.sessions.get_workspace_manager", return_value=source_mgr),
        ):
            resp = client.post(
                "/api/sessions/cleanup-anonymous",
                json={"source_identity": "browser:xyz"},
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["data"]["deleted"] == 3
        source_mgr.delete_all_workspaces.assert_called_once()

    def test_cleanup_rejects_non_user(self, client):
        with patch("data_formulator.routes.sessions.get_identity_id", return_value="browser:abc"):
            resp = client.post(
                "/api/sessions/cleanup-anonymous",
                json={"source_identity": "browser:xyz"},
            )

        assert resp.status_code == 403
        assert resp.get_json()["status"] == "error"
