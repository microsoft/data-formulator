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
        assert data["status"] == "success"
        assert data["data"]["items"] == []

    def test_list_with_entries(self, client, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/list",
                           json={"category": "rules"})
        data = resp.get_json()
        assert data["status"] == "success"
        assert len(data["data"]["items"]) == 1
        assert data["data"]["items"][0]["title"] == "ROI Rule"

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
        assert data["status"] == "success"
        assert "ROI = (revenue - cost) / cost" in data["data"]["content"]

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
        assert data["status"] == "success"
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
        assert data["status"] == "success"
        assert not (rules_dir / "del.md").exists()

    def test_delete_nonexistent(self, client):
        resp = client.post("/api/knowledge/delete",
                           json={"category": "rules", "path": "ghost.md"})
        data = resp.get_json()
        assert data["status"] == "error"


class TestKnowledgeSearch:
    def test_search_returns_results(self, client, tmp_path):
        exp_dir = tmp_path / "knowledge" / "workflows" / "finance"
        exp_dir.mkdir(parents=True, exist_ok=True)
        (exp_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/search",
                           json={"query": "ROI"})
        data = resp.get_json()
        assert data["status"] == "success"
        assert len(data["data"]["results"]) >= 1

    def test_search_empty_query(self, client):
        resp = client.post("/api/knowledge/search",
                           json={"query": ""})
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["data"]["results"] == []

    def test_search_invalid_category(self, client):
        resp = client.post("/api/knowledge/search",
                           json={"query": "test", "categories": ["bad"]})
        data = resp.get_json()
        assert data["status"] == "error"

    def test_search_filters_by_category(self, client, tmp_path):
        exp_dir = tmp_path / "knowledge" / "workflows" / "finance"
        exp_dir.mkdir(parents=True, exist_ok=True)
        (exp_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        resp = client.post("/api/knowledge/search",
                           json={"query": "ROI", "categories": ["rules"]})
        data = resp.get_json()
        assert data["status"] == "success"
        assert len(data["data"]["results"]) == 0


SESSION_WORKFLOW_CONTEXT = {
    "context_id": "ws-1",
    "workspace_id": "ws-1",
    "workspace_name": "Gasoline prices 2024",
    "threads": [
        {
            "thread_id": "leaf-a",
            "events": [
                {"type": "message", "from": "user", "to": "data-agent", "role": "prompt",
                 "content": "load gasoline prices"},
                {"type": "create_table", "table_id": "df_1",
                 "source_tables": ["gas"], "columns": ["price"],
                 "row_count": 1000, "sample_rows": [{"price": 3.5}]},
            ],
        },
        {
            "thread_id": "leaf-b",
            "events": [
                {"type": "message", "from": "user", "to": "data-agent", "role": "prompt",
                 "content": "filter to 2024"},
                {"type": "create_table", "table_id": "df_2",
                 "source_tables": ["df_1"], "columns": ["price"],
                 "row_count": 365, "sample_rows": [{"price": 3.6}]},
            ],
        },
    ],
}

DISTILLED_MD = """\
---
subtitle: monthly sales aggregation
filename: monthly sales
tags: [sales, time-series]
created: 2026-05-06
updated: 2026-05-06
source: distill
source_context: ws-1
---

## When to Use
When analysing monthly sales trends.

## Method
Group by month, sum sales, plot as line.

## Pitfalls & Tips
Beware of timezone-induced bucket drift.
"""


class TestDistillWorkflow:
    def test_distill_workflow_from_context(self, client, tmp_path):
        with patch("data_formulator.routes.agents.get_client", return_value=object()), \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch(
                 "data_formulator.agents.agent_workflow_distill."
                 "WorkflowDistillAgent.run",
                 return_value=DISTILLED_MD,
             ) as run:
            resp = client.post("/api/knowledge/distill-workflow", json={
                "workflow_context": SESSION_WORKFLOW_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })

        data = resp.get_json()
        assert data["status"] == "success"
        assert data["data"]["category"] == "workflows"
        assert (tmp_path / "knowledge" / "workflows" / data["data"]["path"]).exists()
        assert not (tmp_path / "agent-logs").exists()
        run.assert_called_once()

    def test_distill_workflow_llm_timeout_returns_structured_error(self, client):
        with patch("data_formulator.routes.agents.get_client", return_value=object()), \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch(
                 "data_formulator.agents.agent_workflow_distill."
                 "WorkflowDistillAgent.run",
                 side_effect=TimeoutError("request timed out"),
             ):
            resp = client.post("/api/knowledge/distill-workflow", json={
                "workflow_context": SESSION_WORKFLOW_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })

        data = resp.get_json()
        assert resp.status_code == 200
        assert data["status"] == "error"
        assert data["error"]["code"] == "LLM_TIMEOUT"
        assert data["error"]["retry"] is True

    def test_distill_workflow_missing_context(self, client):
        resp = client.post("/api/knowledge/distill-workflow", json={
            "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
        })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_distill_workflow_missing_threads(self, client):
        bad_context = {k: v for k, v in SESSION_WORKFLOW_CONTEXT.items() if k != "threads"}
        resp = client.post("/api/knowledge/distill-workflow", json={
            "workflow_context": bad_context,
            "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
        })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_distill_workflow_missing_workspace(self, client):
        bad_context = {k: v for k, v in SESSION_WORKFLOW_CONTEXT.items()
                       if k not in ("workspace_id", "workspace_name")}
        resp = client.post("/api/knowledge/distill-workflow", json={
            "workflow_context": bad_context,
            "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
        })
        data = resp.get_json()
        assert data["status"] == "error"

    def test_distill_session_uses_descriptive_title(self, client, tmp_path):
        """Session-scoped distillation uses the agent subtitle as the title."""
        with patch("data_formulator.routes.agents.get_client", return_value=object()), \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch(
                 "data_formulator.agents.agent_workflow_distill."
                 "WorkflowDistillAgent.run",
                 return_value=DISTILLED_MD,
             ):
            resp = client.post("/api/knowledge/distill-workflow", json={
                "workflow_context": SESSION_WORKFLOW_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })

        data = resp.get_json()
        assert data["status"] == "success"
        path = data["data"]["path"]
        # Filename is derived from the short agent-emitted `filename` hint,
        # not the long descriptive title.
        assert path == "monthly-sales.md"
        saved = (tmp_path / "knowledge" / "workflows" / path).read_text(encoding="utf-8")
        assert "title: monthly sales aggregation" in saved \
            or "title: 'monthly sales aggregation'" in saved \
            or "title: \"monthly sales aggregation\"" in saved
        # No legacy "Workflow from <name>:" prefix on the title.
        assert "Workflow from" not in saved
        # The filename hint is consumed, not persisted in the front matter.
        assert "filename:" not in saved
        # Workspace stamps are present so the file can be looked up later.
        assert "source_workspace_id: ws-1" in saved
        assert "source_workspace_name: Gasoline prices 2024" in saved
        # Body is preserved verbatim.
        assert "## Method" in saved

    def test_distill_session_upserts_existing_workspace_file(self, client, tmp_path):
        """Re-distilling the same workspace replaces the prior file."""
        second_md = DISTILLED_MD.replace(
            "filename: monthly sales",
            "filename: annual revenue",
        )
        with patch("data_formulator.routes.agents.get_client", return_value=object()), \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch(
                 "data_formulator.agents.agent_workflow_distill."
                 "WorkflowDistillAgent.run",
                 side_effect=[DISTILLED_MD, second_md],
             ):
            client.post("/api/knowledge/distill-workflow", json={
                "workflow_context": SESSION_WORKFLOW_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })
            # Re-distill: the filename hint changes, so the slug changes — old
            # file should be removed in favour of the new one (matched by
            # source_workspace_id).
            resp = client.post("/api/knowledge/distill-workflow", json={
                "workflow_context": SESSION_WORKFLOW_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })

        data = resp.get_json()
        assert data["status"] == "success"
        new_path = data["data"]["path"]
        exp_dir = tmp_path / "knowledge" / "workflows"
        # Stale slug deleted, new slug present.
        assert not (exp_dir / "monthly-sales.md").exists()
        assert (exp_dir / new_path).exists()
        assert new_path == "annual-revenue.md"

    def test_distill_session_strips_legacy_title_prefix(self, client, tmp_path):
        """Update-mode runs strip any legacy 'Workflow from <name>:' prefix."""
        # Simulate a prior run where the LLM echoed a Workflow-prefixed title
        # without a subtitle.
        prior_md = (
            "---\n"
            "title: 'Workflow from Gasoline prices 2024: prior insight'\n"
            "tags: [a]\n"
            "created: 2026-05-06\n"
            "updated: 2026-05-06\n"
            "source: distill\n"
            "---\n\n## Method\nbody\n"
        )
        with patch("data_formulator.routes.agents.get_client", return_value=object()), \
             patch("data_formulator.routes.agents.get_language_instruction", return_value=""), \
             patch(
                 "data_formulator.agents.agent_workflow_distill."
                 "WorkflowDistillAgent.run",
                 return_value=prior_md,
             ):
            resp = client.post("/api/knowledge/distill-workflow", json={
                "workflow_context": SESSION_WORKFLOW_CONTEXT,
                "model": {"endpoint": "openai", "key": "x", "model": "gpt"},
            })

        data = resp.get_json()
        assert data["status"] == "success"
        saved = (tmp_path / "knowledge" / "workflows" / data["data"]["path"]).read_text(encoding="utf-8")
        # The legacy "Workflow from ..." prefix is fully stripped.
        assert "Workflow from" not in saved
        assert "prior insight" in saved
