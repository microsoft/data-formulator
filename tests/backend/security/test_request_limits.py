"""Request-boundary memory safety tests."""

from __future__ import annotations

import flask
import pytest
from unittest.mock import Mock

from data_formulator.errors import ErrorCode

pytestmark = [pytest.mark.backend, pytest.mark.security]


@pytest.fixture()
def app():
    test_app = flask.Flask(__name__)
    test_app.config.update(
        TESTING=True,
        MAX_CONTENT_LENGTH=1_000,
        MAX_JSON_REQUEST_BYTES=200,
        MAX_EPHEMERAL_TABLE_BYTES=80,
        MAX_INLINE_IMAGE_BYTES=40,
    )

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.security.request_limits import register_request_limits

    register_error_handlers(test_app)
    register_request_limits(test_app)

    @test_app.post("/api/inspect")
    def inspect():
        return flask.jsonify(flask.request.get_json())

    return test_app


@pytest.fixture()
def client(app):
    return app.test_client()


def _assert_too_large(response) -> None:
    assert response.status_code == 413
    body = response.get_json()
    assert body["status"] == "error"
    assert body["error"]["code"] == ErrorCode.FILE_TOO_LARGE


def test_rejects_json_wire_body_before_route_materialization(client) -> None:
    response = client.post("/api/inspect", json={"value": "x" * 250})

    _assert_too_large(response)


def test_rejects_ephemeral_tables_over_decoded_budget(client) -> None:
    response = client.post(
        "/api/inspect",
        json={
            "_workspace_tables": [
                {"name": "orders", "rows": [{"value": "x" * 100}]},
            ],
        },
    )

    _assert_too_large(response)


def test_rejected_ephemeral_tables_never_reach_route_materialization() -> None:
    test_app = flask.Flask(__name__)
    test_app.config.update(
        TESTING=True,
        MAX_CONTENT_LENGTH=1_000,
        MAX_JSON_REQUEST_BYTES=500,
        MAX_EPHEMERAL_TABLE_BYTES=40,
        MAX_INLINE_IMAGE_BYTES=100,
    )
    materialize = Mock()

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.security.request_limits import register_request_limits

    register_error_handlers(test_app)
    register_request_limits(test_app)

    @test_app.post("/api/materialize")
    def materialize_route():
        materialize()
        return "ok"

    with test_app.test_client() as client:
        response = client.post(
            "/api/materialize",
            json={
                "_workspace_tables": [
                    {"name": "orders", "rows": [{"value": "x" * 80}]},
                ],
            },
        )

    _assert_too_large(response)
    materialize.assert_not_called()


def test_rejects_inline_images_over_decoded_budget(client) -> None:
    response = client.post(
        "/api/inspect",
        json={
            "messages": [
                {
                    "attachments": [
                        {
                            "type": "image",
                            "url": "data:image/png;base64," + "a" * 60,
                        },
                    ],
                },
            ],
        },
    )

    _assert_too_large(response)


def test_accepts_payloads_within_all_budgets(client) -> None:
    response = client.post(
        "/api/inspect",
        json={
            "_workspace_tables": [{"name": "small", "rows": [{"value": 1}]}],
            "attached_images": ["data:image/png;base64,abc"],
        },
    )

    assert response.status_code == 200
