# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the /api/knowledge/* REST endpoints.

Covers list, read, write, delete, search — including validation errors,
path traversal rejection, and missing-file handling.  Uses a real
KnowledgeStore backed by tmp_path (no external deps).
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import flask
import pytest

from data_formulator.routes.knowledge import knowledge_bp

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def app(tmp_path):
    from data_formulator.error_handler import register_error_handlers

    _app = flask.Flask(__name__)
    _app.config["TESTING"] = True
    _app.secret_key = "test"
    _app.register_blueprint(knowledge_bp)
    register_error_handlers(_app)

    with patch("data_formulator.routes.knowledge.get_identity_id", return_value="test-user"), \
         patch("data_formulator.routes.knowledge.get_user_home", return_value=tmp_path):
        yield _app


@pytest.fixture()
def client(app):
    return app.test_client()


SAMPLE_MD = """\
---
title: ROI Rule
tags: [finance]
created: 2026-04-26
updated: 2026-04-26
source: manual
---

ROI = (revenue - cost) / cost
"""


class TestKnowledgeList:
    def test_list_empty(self, client, tmp_path):
        (tmp_path / "knowledge" / "rules").mkdir(parents=True, exist_ok=True)
        resp = client.post("/api/knowledge/list",
                           json={"category": "rules"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["items"] == []

    def test_list_with_entries(self, client, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/list",
                           json={"category": "rules"})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert len(data["items"]) == 1
        assert data["items"][0]["title"] == "ROI Rule"

    def test_list_invalid_category(self, client):
        resp = client.post("/api/knowledge/list",
                           json={"category": "invalid"})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_list_missing_category(self, client):
        resp = client.post("/api/knowledge/list", json={})
        data = resp.get_json()
        assert data["status"] == "error"


class TestKnowledgeRead:
    def test_read_existing(self, client, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/read",
                           json={"category": "rules", "path": "roi.md"})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert "ROI = (revenue - cost) / cost" in data["content"]

    def test_read_nonexistent(self, client):
        resp = client.post("/api/knowledge/read",
                           json={"category": "rules", "path": "nope.md"})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_read_traversal_rejected(self, client):
        resp = client.post("/api/knowledge/read",
                           json={"category": "rules", "path": "../../../etc/passwd.md"})
        data = resp.get_json()
        assert data["status"] == "error"


class TestKnowledgeWrite:
    def test_write_creates_file(self, client, tmp_path):
        resp = client.post("/api/knowledge/write",
                           json={"category": "rules", "path": "new.md",
                                 "content": SAMPLE_MD})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert (tmp_path / "knowledge" / "rules" / "new.md").exists()

    def test_write_updates_file(self, client, tmp_path):
        client.post("/api/knowledge/write",
                    json={"category": "rules", "path": "upd.md",
                          "content": "v1"})
        client.post("/api/knowledge/write",
                    json={"category": "rules", "path": "upd.md",
                          "content": "v2"})
        content = (tmp_path / "knowledge" / "rules" / "upd.md").read_text(encoding="utf-8")
        assert "v2" in content

    def test_write_traversal_rejected(self, client):
        resp = client.post("/api/knowledge/write",
                           json={"category": "rules", "path": "../../evil.md",
                                 "content": "bad"})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_write_non_md_rejected(self, client):
        resp = client.post("/api/knowledge/write",
                           json={"category": "rules", "path": "file.txt",
                                 "content": "bad"})
        data = resp.get_json()
        assert data["status"] == "error"


class TestKnowledgeDelete:
    def test_delete_existing(self, client, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        (rules_dir / "del.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/delete",
                           json={"category": "rules", "path": "del.md"})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert not (rules_dir / "del.md").exists()

    def test_delete_nonexistent(self, client):
        resp = client.post("/api/knowledge/delete",
                           json={"category": "rules", "path": "ghost.md"})
        data = resp.get_json()
        assert data["status"] == "error"


class TestKnowledgeSearch:
    def test_search_returns_results(self, client, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/search",
                           json={"query": "ROI"})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert len(data["results"]) >= 1

    def test_search_empty_query(self, client):
        resp = client.post("/api/knowledge/search",
                           json={"query": ""})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["results"] == []

    def test_search_invalid_category(self, client):
        resp = client.post("/api/knowledge/search",
                           json={"query": "test", "categories": ["bad"]})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_search_filters_by_category(self, client, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/search",
                           json={"query": "ROI", "categories": ["skills"]})
        data = resp.get_json()
        assert data["status"] == "ok"
        assert len(data["results"]) == 0
