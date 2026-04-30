"""Contract tests for /api/knowledge/ endpoints.

Validates the Phase 2 unified response envelope:
- Success: HTTP 200 + {"status": "success", "data": {...}}
- Error: HTTP 4xx/5xx + {"status": "error", "error": {code, message, retry}}
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.errors import ErrorCode

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def app():
    test_app = flask.Flask(__name__)
    test_app.config["TESTING"] = True

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.routes.knowledge import knowledge_bp
    test_app.register_blueprint(knowledge_bp)
    register_error_handlers(test_app)

    return test_app


@pytest.fixture()
def client(app):
    return app.test_client()


class TestKnowledgeLimits:

    def test_returns_limits_in_success_envelope(self, client):
        resp = client.post("/api/knowledge/limits", json={})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert "limits" in body["data"]


class TestKnowledgeList:

    def test_missing_category_returns_error(self, client):
        resp = client.post("/api/knowledge/list", json={})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    def test_invalid_category_returns_error(self, client):
        resp = client.post("/api/knowledge/list", json={"category": "invalid_cat"})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    @patch("data_formulator.routes.knowledge._get_store")
    def test_success_returns_items(self, mock_store, client):
        store = MagicMock()
        store.list_all.return_value = [{"path": "a.md"}, {"path": "b.md"}]
        mock_store.return_value = store

        resp = client.post("/api/knowledge/list", json={"category": "rules"})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert len(body["data"]["items"]) == 2


class TestKnowledgeRead:

    def test_missing_fields_returns_error(self, client):
        resp = client.post("/api/knowledge/read", json={"category": "rules"})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    @patch("data_formulator.routes.knowledge._get_store")
    def test_file_not_found_returns_error(self, mock_store, client):
        store = MagicMock()
        store.read.side_effect = FileNotFoundError()
        mock_store.return_value = store

        resp = client.post("/api/knowledge/read", json={"category": "rules", "path": "missing.md"})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.TABLE_NOT_FOUND

    @patch("data_formulator.routes.knowledge._get_store")
    def test_success_returns_content(self, mock_store, client):
        store = MagicMock()
        store.read.return_value = "# Hello"
        mock_store.return_value = store

        resp = client.post("/api/knowledge/read", json={"category": "rules", "path": "hello.md"})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert body["data"]["content"] == "# Hello"
        assert body["data"]["category"] == "rules"


class TestKnowledgeSearch:

    @patch("data_formulator.routes.knowledge._get_store")
    def test_success_returns_results(self, mock_store, client):
        store = MagicMock()
        store.search.return_value = [{"path": "a.md", "score": 0.9}]
        mock_store.return_value = store

        resp = client.post("/api/knowledge/search", json={"query": "test"})
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["status"] == "success"
        assert len(body["data"]["results"]) == 1

    def test_invalid_categories_type_returns_error(self, client):
        resp = client.post("/api/knowledge/search", json={"query": "x", "categories": "not-a-list"})
        body = resp.get_json()
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST
