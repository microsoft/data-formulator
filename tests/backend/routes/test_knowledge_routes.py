# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for the /api/knowledge/* REST endpoints.

Covers list, read, write, delete, search — including validation errors,
path traversal rejection, and missing-file handling.  Uses a real
KnowledgeStore backed by tmp_path (no external deps).
"""

from __future__ import annotations

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


EXPERIENCE_CONTEXT = {
    "context_id": "table-123",
    "source_table_id": "source-1",
    "user_question": "Analyze monthly sales",
    "dialog": [{"role": "user", "content": "Analyze monthly sales"}],
    "interaction": [
        {"from": "user", "role": "prompt", "content": "Analyze monthly sales"},
        {"from": "data-agent", "role": "summary", "content": "Sales increased"},
    ],
    "result_summary": {
        "display_instruction": "Monthly sales trend",
        "output_fields": ["month", "sales"],
        "output_rows": 12,
        "code": "result_df = df.groupby('month').sum()",
    },
    "execution_attempts": [
        {"kind": "visualize", "status": "ok", "summary": "Monthly sales trend"},
    ],
}


class TestDistillExperience:
    def test_distill_experience_from_context(self, client, tmp_path):
        with patch("data_formulator.routes.agents.get_client", return_value=object()), \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch(
                 "data_formulator.agents.agent_experience_distill."
                 "ExperienceDistillAgent.run_from_context",
                 return_value=SAMPLE_MD,
             ) as run_from_context:
            resp = client.post("/api/knowledge/distill-experience", json={
                "experience_context": EXPERIENCE_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })

        data = resp.get_json()
        assert data["status"] == "ok"
        assert data["category"] == "experiences"
        assert (tmp_path / "knowledge" / "experiences" / data["path"]).exists()
        assert not (tmp_path / "agent-logs").exists()
        run_from_context.assert_called_once()

    def test_distill_experience_missing_context(self, client):
        resp = client.post("/api/knowledge/distill-experience", json={
            "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
        })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_distill_experience_missing_required_context_field(self, client):
        bad_context = {**EXPERIENCE_CONTEXT}
        bad_context.pop("result_summary")
        resp = client.post("/api/knowledge/distill-experience", json={
            "experience_context": bad_context,
            "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
        })
        data = resp.get_json()
        assert data["status"] == "error"
