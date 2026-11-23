# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Wormhole session sharing: codes, request guards, and what is sent and imported (design-docs/71)."""

from __future__ import annotations

import hashlib
import io
import json
import os
import time
import zipfile
from unittest.mock import patch

import flask
import pytest

from data_formulator import session_wormhole
from data_formulator.datalake.workspace_manager import WorkspaceManager
from data_formulator.routes.sessions import session_bp

pytestmark = [pytest.mark.backend]

ORIGIN = {"Origin": "http://localhost"}


@pytest.fixture
def client():
    from data_formulator.error_handler import register_error_handlers

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(session_bp)
    register_error_handlers(app)
    return app.test_client()


@pytest.fixture
def manager(tmp_path):
    mgr = WorkspaceManager(tmp_path / "workspaces")
    with (
        patch("data_formulator.routes.sessions.get_identity_id", return_value="local:alice"),
        patch("data_formulator.routes.sessions.get_workspace_manager", return_value=mgr),
        patch.object(session_wormhole, "enabled", return_value=True),
    ):
        yield mgr


def _error_code(response) -> str:
    return response.get_json()["error"]["code"]


@pytest.mark.parametrize("typed, code", [
    ("7-guitarist-revenge", "7-guitarist-revenge"),
    ("  7 Guitarist  revenge ", "7-guitarist-revenge"),
    ("12-a-b-c", "12-a-b-c"),
])
def test_codes_are_normalized(typed, code):
    assert session_wormhole.normalize_code(typed) == code


@pytest.mark.parametrize("typed", ["", "guitarist-revenge", "7", "7-../etc", "7-" + "a" * 120])
def test_malformed_codes_are_refused(typed):
    with pytest.raises(ValueError):
        session_wormhole.normalize_code(typed)


def test_routes_are_closed_outside_local_mode(client):
    with patch.object(session_wormhole, "enabled", return_value=False):
        response = client.get("/api/sessions/wormhole/transfers")
    assert _error_code(response) == "ACCESS_DENIED"


def test_requests_must_come_from_the_app_itself(client, manager):
    assert _error_code(client.post("/api/sessions/wormhole/receive", json={"code": "7-a-b"},
                                   headers={"Origin": "https://evil.example"})) == "ACCESS_DENIED"
    assert _error_code(client.post("/api/sessions/wormhole/receive", json={"code": "7-a-b"})) == "ACCESS_DENIED"
    # A DNS-rebinding page reaches the server under another host name.
    assert _error_code(client.get("/api/sessions/wormhole/transfers",
                                  headers={"Host": "attacker.example"})) == "ACCESS_DENIED"
    assert _error_code(client.get("/api/sessions/wormhole/transfers",
                                  headers={"Sec-Fetch-Site": "cross-site"})) == "ACCESS_DENIED"
    assert client.get("/api/sessions/wormhole/transfers").get_json()["status"] == "success"


def test_send_offers_the_cleaned_archive(client, manager):
    manager.create_workspace("session_1")
    manager.save_session_state("session_1", {
        "activeWorkspace": {"id": "session_1", "displayName": "Sales"},
        "globalModels": [{"api_base": "https://internal.example"}], "models": [{"api_key": "k"}], "charts": [],
    })
    sent = {}

    def fake_start_send(owner, workspace_id, display_name, archive):
        sent.update(owner=owner, workspace_id=workspace_id, display_name=display_name, archive=archive)
        return {"id": "t1", "status": "waiting", "code": "7-a-b"}

    with patch.object(session_wormhole, "start_send", side_effect=fake_start_send):
        response = client.post("/api/sessions/wormhole/send", json={"workspace_id": "session_1"}, headers=ORIGIN)

    assert response.get_json()["data"]["transfer"]["code"] == "7-a-b"
    assert (sent["owner"], sent["workspace_id"], sent["display_name"]) == ("local:alice", "session_1", "Sales")
    with zipfile.ZipFile(io.BytesIO(sent["archive"])) as zf:
        state = json.loads(zf.read("state.json"))
        assert "workspace/session_state.json" not in zf.namelist()
    assert state == {"activeWorkspace": {"displayName": "Sales"}, "charts": []}


def test_send_needs_an_existing_session(client, manager):
    response = client.post("/api/sessions/wormhole/send", json={"workspace_id": "missing"}, headers=ORIGIN)
    assert _error_code(response) == "TABLE_NOT_FOUND"


def test_received_archive_becomes_a_new_listed_session(client, manager, tmp_path):
    manager.create_workspace("session_src")
    source = manager.open_workspace("session_src", "local:bob")
    source.save_workspace_file(b"# Guide", "guide.md", "text/markdown")
    from data_formulator.datalake.session_archive import build_session_archive
    archive = tmp_path / "received.zip"
    archive.write_bytes(build_session_archive(source, {"activeWorkspace": {"displayName": "Bob's analysis"},
                                                       "charts": [{"id": "c1"}]}).getvalue())
    captured = {}

    def fake_start_receive(owner, code, importer):
        captured.update(owner=owner, code=code, importer=importer)
        return {"id": "t2", "status": "connecting"}

    with patch.object(session_wormhole, "start_receive", side_effect=fake_start_receive):
        response = client.post("/api/sessions/wormhole/receive", json={"code": " 7 Guitarist revenge"}, headers=ORIGIN)
    assert response.get_json()["status"] == "success"
    assert captured["code"] == "7-guitarist-revenge"

    workspace_id, name = captured["importer"](archive, "offered")
    assert name == "Bob's analysis"
    state = manager.load_session_state(workspace_id)
    assert state["activeWorkspace"] == {"id": workspace_id, "displayName": "Bob's analysis"}
    assert state["charts"] == [{"id": "c1"}]
    assert manager.open_workspace(workspace_id, "local:alice").read_workspace_file("guide.md")[1] == b"# Guide"
    assert any(item["id"] == workspace_id for item in manager.list_workspaces())

    not_a_session = tmp_path / "other.zip"
    with zipfile.ZipFile(not_a_session, "w") as zf:
        zf.writestr("readme.txt", "hello")
    before = {item["id"] for item in manager.list_workspaces()}
    with pytest.raises(ValueError):
        captured["importer"](not_a_session, "other")
    assert {item["id"] for item in manager.list_workspaces()} == before


def test_receive_rejects_malformed_codes(client, manager):
    response = client.post("/api/sessions/wormhole/receive", json={"code": "not a code"}, headers=ORIGIN)
    assert _error_code(response) == "INVALID_REQUEST"


@pytest.mark.live
@pytest.mark.skipif(os.environ.get("DF_WORMHOLE_LIVE") != "1", reason="set DF_WORMHOLE_LIVE=1 to use the public relay")
def test_live_round_trip_through_the_public_relay():
    payload = os.urandom(200_000)
    received = {}

    def importer(path, offered_name):
        received["hash"] = hashlib.sha256(path.read_bytes()).hexdigest()
        return "session_new", offered_name

    sent = session_wormhole.start_send("live:a", "session_1", "Live test", payload)
    assert sent["status"] == "waiting" and sent["code"]
    session_wormhole.start_receive("live:b", sent["code"], importer)
    deadline = time.time() + 60
    while time.time() < deadline:
        statuses = [t["status"] for t in session_wormhole.list_transfers("live:a") + session_wormhole.list_transfers("live:b")]
        if all(status not in session_wormhole.ACTIVE_STATUSES for status in statuses):
            break
        time.sleep(0.5)
    assert [t["status"] for t in session_wormhole.list_transfers("live:a")] == ["done"]
    [receive] = session_wormhole.list_transfers("live:b")
    assert (receive["status"], receive["workspace_id"], receive["display_name"]) == ("done", "session_new", "Live test")
    assert received["hash"] == hashlib.sha256(payload).hexdigest()
