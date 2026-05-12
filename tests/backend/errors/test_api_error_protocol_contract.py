from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import flask
import pytest

from data_formulator.errors import ErrorCode

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def tables_client():
    from data_formulator.error_handler import register_error_handlers
    from data_formulator.routes.tables import tables_bp

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
    register_error_handlers(app)
    return app.test_client()


class TestTablesErrorProtocol:

    def test_download_db_file_returns_structured_business_error(self, tables_client):
        resp = tables_client.get("/api/tables/download-db-file")
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    def test_export_csv_missing_table_returns_structured_error(self, tables_client):
        resp = tables_client.post("/api/tables/export-table-csv", json={})
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST
        assert "table_name" in body["error"]["message"]

    def test_export_csv_invalid_delimiter_returns_structured_error(self, tables_client):
        resp = tables_client.post(
            "/api/tables/export-table-csv",
            json={"table_name": "orders", "delimiter": "|"},
        )
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    @pytest.mark.parametrize(
        "raw_error,expected_code",
        [
            (Exception("Table orders does not exist"), ErrorCode.TABLE_NOT_FOUND),
            (Exception("Catalog Error: missing table"), ErrorCode.TABLE_NOT_FOUND),
            (Exception("Binder Error: bad column"), ErrorCode.INVALID_REQUEST),
            (Exception("syntax error at or near SELECT"), ErrorCode.INVALID_REQUEST),
        ],
    )
    def test_db_error_classification_defaults_to_http_200(self, raw_error, expected_code):
        from data_formulator.routes.tables import classify_and_raise_db_error
        from data_formulator.errors import AppError

        with pytest.raises(AppError) as exc_info:
            classify_and_raise_db_error(raw_error)

        assert exc_info.value.code == expected_code
        assert exc_info.value.status_code == 200
        assert exc_info.value.get_http_status() == 200


@pytest.fixture()
def agents_client():
    from data_formulator.routes.agents import agent_bp

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.config["CLI_ARGS"] = {}
    app.register_blueprint(agent_bp)
    return app.test_client()


class TestStreamingErrorProtocol:

    def test_stream_preflight_error_uses_json_error_envelope(self, agents_client):
        resp = agents_client.post(
            "/api/agent/data-agent-streaming",
            data="not json",
            content_type="text/plain",
        )
        body = resp.get_json()
        assert resp.status_code == 200
        assert body["status"] == "error"
        assert body["error"]["code"] == ErrorCode.INVALID_REQUEST

    def test_data_agent_streaming_emits_top_level_type_events(self, agents_client):
        agent_instance = MagicMock()
        agent_instance.run.return_value = [
            {"type": "text_delta", "content": "hello"},
            {"type": "completion", "content": {"summary": "done"}},
        ]

        with (
            patch("data_formulator.routes.agents.get_identity_id", return_value="user-1"),
            patch("data_formulator.routes.agents.get_client", return_value=object()),
            patch("data_formulator.routes.agents.get_workspace", return_value=object()),
            patch("data_formulator.datalake.workspace.get_user_home", return_value=object()),
            patch("data_formulator.routes.agents.DataAgent", return_value=agent_instance),
        ):
            resp = agents_client.post(
                "/api/agent/data-agent-streaming",
                json={
                    "model": {},
                    "input_tables": [],
                    "user_question": "what changed?",
                },
            )

        assert resp.status_code == 200
        events = [json.loads(line) for line in resp.data.decode("utf-8").splitlines()]
        assert [event["type"] for event in events] == ["text_delta", "completion"]
        assert all("status" not in event for event in events)
        assert all("result" not in event for event in events)
        assert all("token" not in event for event in events)
