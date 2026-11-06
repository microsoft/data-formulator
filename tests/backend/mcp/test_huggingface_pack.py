"""The Hugging Face tool pack: dataset search, details and previews, and loading a split as Parquet in part.

Offline: the Hub and the dataset viewer are a mock transport that also serves Parquet files by HTTP range.
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from unittest.mock import Mock

import httpx
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from data_formulator.tool_packs.huggingface import server

pytestmark = [pytest.mark.backend]

PARQUET_URL = "https://huggingface.co/datasets/acme/sales/resolve/refs%2Fconvert%2Fparquet/default/train/0000.parquet"
STORAGE_URL = "https://cdn.example/acme/sales/0000.parquet"


def parquet_bytes(rows: int = 1000, row_group: int = 100) -> bytes:
    table = pa.table({"month": [f"2026-{i % 12 + 1:02d}" for i in range(rows)], "region": ["east", "west"] * (rows // 2),
                      "sales": list(range(rows)),
                      "photo": pa.array([{"bytes": b"\x89PNG", "path": "a.png"}] * rows,
                                        pa.struct([("bytes", pa.binary()), ("path", pa.string())]))})
    buffer = io.BytesIO()
    pq.write_table(table, buffer, row_group_size=row_group)
    return buffer.getvalue()


def viewer(data: bytes, requests: list[httpx.Request]):
    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        url, path = request.url, request.url.path
        if url.host == "huggingface.co" and path == "/api/datasets":
            return httpx.Response(200, json=[
                {"id": "acme/sales", "downloads": 900, "likes": 4, "gated": False, "lastModified": "2026-10-01T00:00:00Z",
                 "description": "Monthly   sales\nby region.", "cardData": {"pretty_name": "Sales"},
                 "tags": ["license:cc-by-4.0", "size_categories:1K<n<10K", "format:parquet", "modality:tabular"]},
                {"id": "acme/fake", "downloads": 50, "tags": ["synthetic-data", "modality:tabular"], "gated": "auto"},
                {"id": "acme/hidden", "private": True, "tags": []}])
        if path == "/api/datasets/acme/sales":
            return httpx.Response(200, json={"id": "acme/sales", "tags": ["license:mit"], "cardData": {"citation": "@misc{s}"}})
        if path == "/datasets/acme/sales/resolve/main/README.md":
            return httpx.Response(200, text="---\nlicense: mit\n---\n# Sales\nMonthly sales.")
        if path == "/splits":
            return httpx.Response(200, json={"splits": [{"config": "default", "split": "train"}, {"config": "default", "split": "test"},
                                                        {"config": "eu", "split": "train"}]})
        if path == "/size":
            return httpx.Response(200, json={"size": {"splits": [
                {"config": "default", "split": "train", "num_rows": 1000, "num_bytes_parquet_files": 2_500_000}]}})
        if path == "/info":
            return httpx.Response(200, json={"dataset_info": {"features": {
                "month": {"dtype": "string", "_type": "Value"}, "region": {"names": ["east", "west"], "_type": "ClassLabel"},
                "tags": {"feature": {"dtype": "string", "_type": "Value"}, "_type": "Sequence"}, "photo": {"_type": "Image"}}}})
        if path == "/rows":
            return httpx.Response(200, json={"num_rows_total": 1000,
                                             "features": [{"name": "note", "type": {"dtype": "string", "_type": "Value"}}],
                                             "rows": [{"row_idx": 0, "row": {"note": "x" * 1000, "photo": {"src": "https://i", "height": 4}}}]})
        if path == "/parquet":
            return httpx.Response(200, json={"parquet_files": [{"config": "default", "split": "train", "filename": "0000.parquet",
                                                                "url": PARQUET_URL, "size": len(data)}], "partial": False})
        if str(url) == PARQUET_URL:
            return httpx.Response(307, headers={"location": STORAGE_URL})
        if str(url) == STORAGE_URL:
            if request.method == "HEAD":
                return httpx.Response(200, headers={"content-length": str(len(data))})
            start, end = (int(part) for part in request.headers["range"].removeprefix("bytes=").split("-"))
            return httpx.Response(206, content=data[start:end + 1])
        return httpx.Response(404, json={"error": "Not found"})
    return handle


@pytest.fixture
def hub(monkeypatch, tmp_path):
    def install(data: bytes = b"", token: str | None = None, handler=None):
        requests: list[httpx.Request] = []
        client = server.Client(tmp_path, token, transport=httpx.MockTransport(handler or viewer(data, requests)))
        monkeypatch.setattr(server, "_client", client)
        return requests
    return install


def test_search_lists_public_tabular_datasets_with_their_flags(hub, tmp_path):
    requests = hub(token="hf_secret")
    found = server.search_datasets("sales", sort="trending", limit=500)
    assert [row["dataset"] for row in found["datasets"]] == ["acme/sales", "acme/fake"] and found["returned"] == 2
    sales, fake = found["datasets"]
    assert sales["summary"] == "Monthly sales by region." and sales["license"] == "cc-by-4.0" and sales["size"] == "1K<n<10K"
    assert not sales["synthetic"] and fake["synthetic"] and fake["gated"]
    params = requests[0].url.params
    assert params["filter"] == "modality:tabular" and params["sort"] == "trendingScore" and params["limit"] == "50"
    # The token goes in a header, never in the URL or the cache.
    assert requests[0].headers["authorization"] == "Bearer hf_secret" and "hf_secret" not in str(requests[0].url)
    assert not any("hf_secret" in path.read_text() for path in tmp_path.glob("*.json"))
    server.search_datasets("sales", sort="trending", limit=500)
    assert len(requests) == 1


def test_details_preview_and_choosing_a_split(hub):
    hub()
    details = server.dataset_details("https://huggingface.co/datasets/acme/sales")
    assert details["dataset"] == "acme/sales" and details["license"] == "mit" and details["readme"] == "# Sales\nMonthly sales."
    assert details["tables"] == [{"config": "default", "split": "train", "rows": 1000, "parquet_mb": 2.5}]
    assert details["columns"]["types"] == {"month": "string", "region": "label (east, west)", "tags": "list of string", "photo": "image"}
    preview = server.preview_rows("acme/sales", length=500)
    assert preview["config"] == "default" and preview["split"] == "train" and preview["total_rows"] == 1000
    assert preview["rows"][0]["photo"] == "[image]" and len(preview["rows"][0]["note"]) == server.MAX_CELL + 1
    with pytest.raises(server.HuggingFaceError, match="no split 'validation'; its splits are: train, test"):
        server.preview_rows("acme/sales", split="validation")
    with pytest.raises(server.HuggingFaceError, match="no subset 'us'; its subsets are: default, eu"):
        server.preview_rows("acme/sales", config="us")
    with pytest.raises(server.HuggingFaceError, match="owner/name"):
        server.preview_rows("not a dataset!")


def test_loads_a_split_in_part_as_parquet(hub):
    data = parquet_bytes()
    requests = hub(data)
    content = server.load_dataset("acme/sales", columns=["month", "sales"], max_rows=250)
    table = pq.read_table(io.BytesIO(base64.b64decode(content[1].resource.blob)))
    assert table.schema.names == ["month", "sales"] and table.num_rows == 250 and table["sales"][249].as_py() == 249
    assert content[1].resource.mime_type == server.PARQUET_MIME and str(content[1].resource.uri).endswith("default/train.parquet")
    assert "Loaded 250 of 1,000 rows and 2 columns" in content[0].text and "raise max_rows" in content[0].text
    # Read by range from the file's storage, a part at a time: the whole file is never fetched.
    ranged = [request for request in requests if "range" in request.headers]
    assert ranged and all(str(request.url) == STORAGE_URL for request in ranged)

    # All columns but the image one by default; the whole split when it fits.
    content = server.load_dataset("acme/sales")
    table = pq.read_table(io.BytesIO(base64.b64decode(content[1].resource.blob)))
    assert table.schema.names == ["month", "region", "sales"] and table.num_rows == 1000
    assert "Left out image or audio columns: photo." in content[0].text
    with pytest.raises(server.HuggingFaceError, match="no column 'revenue'"):
        server.load_dataset("acme/sales", columns=["revenue"])


def test_cuts_a_file_over_the_size_limit(hub, monkeypatch):
    hub(parquet_bytes(rows=4000))
    monkeypatch.setattr(server, "MAX_FILE_BYTES", 6_000)
    content = server.load_dataset("acme/sales", columns=["month", "sales"])
    data = base64.b64decode(content[1].resource.blob)
    assert len(data) <= 6_000 and 0 < pq.read_table(io.BytesIO(data)).num_rows < 4000
    assert "to keep the file under" in content[0].text


def test_gated_datasets_and_rate_limits_say_what_to_do(hub):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/splits":
            return httpx.Response(401, json={"error": "The dataset does not exist, or is not accessible without authentication "
                                                      "(private or gated)."})
        return httpx.Response(429, headers={"ratelimit": '"api";r=0;t=42'})
    hub(handler=handler)
    with pytest.raises(server.HuggingFaceError, match="accept its terms at https://huggingface.co/datasets/meta/evals and add "
                                                      "a Hugging Face token"):
        server.preview_rows("meta/evals")
    with pytest.raises(server.HuggingFaceError, match="wait about 42 seconds"):
        server.search_datasets("x")


# -- sign-in: Sign in with Hugging Face (device code), this computer's login, or a pasted token -----------------

HEADERS = {"Origin": "http://localhost", "X-DF-Configuration": "1"}


@pytest.fixture
def api(monkeypatch, tmp_path):
    from unittest.mock import patch

    import flask

    from data_formulator.auth import github_device_flow
    from data_formulator.error_handler import register_error_handlers
    from data_formulator.mcp_servers.routes import mcp_bp
    from data_formulator.tool_packs import signin

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("CREDENTIAL_VAULT", "local")
    monkeypatch.delenv("HF_TOOLS_CLIENT_ID", raising=False)
    # A fresh vault per test (it is a process-wide singleton).
    monkeypatch.setattr("data_formulator.auth.vault._vault", None)
    monkeypatch.setattr("data_formulator.auth.vault._initialized", False)
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.configuration.user_connectors_disabled", lambda: False)
    monkeypatch.setattr("data_formulator.mcp_servers.routes._restart", lambda server_id: None)
    clock = [1000.0]
    monkeypatch.setattr(github_device_flow.time, "time", lambda: clock[0])
    monkeypatch.setattr(signin.time, "time", lambda: clock[0])
    monkeypatch.setattr(signin, "_logins", {})
    monkeypatch.setattr(signin, "_local_hf_token", lambda: None)
    accounts = {"hf_device": "ada", "hf_renewed": "ada", "hf_local": "grace", "hf_local2": "grace", "hf_pasted": "linus"}
    monkeypatch.setattr(signin.http, "get", lambda url, headers, **_: Mock(
        status_code=200 if headers["Authorization"].removeprefix("Bearer ") in accounts else 401,
        json=lambda: {"name": accounts.get(headers["Authorization"].removeprefix("Bearer "))}))
    app = flask.Flask(__name__)
    app.register_blueprint(mcp_bp)
    register_error_handlers(app)
    with patch("data_formulator.auth.identity.get_identity_id", return_value="local:me"):
        yield app.test_client(), clock, github_device_flow, signin


def hf_pack(client) -> dict:
    return next(pack for pack in client.get("/api/mcp/packs").get_json()["data"]["packs"] if pack["id"] == "huggingface")


def test_signing_in_with_hugging_face_keeps_a_renewable_token(api, monkeypatch):
    from data_formulator.mcp_servers import config as mcp_config

    client, clock, device, signin = api
    assert hf_pack(client)["signin"] == {"provider": "huggingface", "token_setting": "hf_token", "signed_in": False,
                                         "login": None, "reusable_login": None}
    server_id = client.post("/api/mcp/packs/huggingface", headers=HEADERS, json={}).get_json()["data"]["id"]
    posts = Mock(side_effect=[
        Mock(status_code=200, json=lambda: {"device_code": "private", "user_code": "8EMZ-J4M3",
                                            "verification_uri": "https://hf.co/oauth/device", "expires_in": 300}),
        Mock(status_code=400, json=lambda: {"error": "authorization_pending"}),
        Mock(status_code=200, json=lambda: {"access_token": "hf_device", "refresh_token": "hf_refresh", "expires_in": 3600}),
    ])
    monkeypatch.setattr(device.http, "post", posts)
    started = client.post("/api/mcp/packs/huggingface/signin/start", headers=HEADERS, json={}).get_json()["data"]
    assert started["user_code"] == "8EMZ-J4M3" and started["authorization_url"] == "https://hf.co/oauth/device"
    # Hugging Face takes form fields; until we register our own app, huggingface_hub's public one, asking to read
    # gated datasets the user accepted and nothing private.
    sent = posts.call_args_list[0].kwargs["data"]
    assert sent == {"client_id": signin.HF_CLI_CLIENT_ID, "scope": "openid profile gated-repos"}
    clock[0] += 5
    pending = client.post("/api/mcp/packs/huggingface/signin/poll", headers=HEADERS, json={"flow_id": started["flow_id"]}).get_json()["data"]
    assert pending["flow"]["status"] == "pending"
    clock[0] += 5
    done = client.post("/api/mcp/packs/huggingface/signin/poll", headers=HEADERS, json={"flow_id": started["flow_id"]}).get_json()["data"]
    assert done["signed_in"] is True and done["login"] == "ada" and "hf_device" not in json.dumps(done)
    stored = mcp_config.read_secrets("local:me", server_id)
    assert stored["env"] == {"HF_TOKEN": "hf_device"} and stored["signin_refresh"] == "hf_refresh"
    assert stored["signin_expires_at"] == clock[0] + 3600 and stored["signin_client_id"] == signin.HF_CLI_CLIENT_ID

    # Used near its expiry, the token is renewed first (its server then restarts with the new one).
    server = mcp_config.get_server(server_id)
    signin.prepare("local:me", server)
    assert posts.call_count == 3  # still fresh: nothing to do
    clock[0] += 3600 - 60
    renew = Mock(return_value=Mock(status_code=200, json=lambda: {"access_token": "hf_renewed", "expires_in": 3600}))
    monkeypatch.setattr(device.http, "post", renew)
    signin.prepare("local:me", server)
    assert renew.call_args.kwargs["data"] == {"grant_type": "refresh_token", "refresh_token": "hf_refresh",
                                              "client_id": signin.HF_CLI_CLIENT_ID}
    stored = mcp_config.read_secrets("local:me", server_id)
    assert stored["env"] == {"HF_TOKEN": "hf_renewed"} and stored["signin_refresh"] == "hf_refresh" and stored["signin_login"] == "ada"


def test_this_computers_hugging_face_login_is_used_and_followed(api, monkeypatch):
    from data_formulator.mcp_servers import config as mcp_config

    client, _, _, signin = api
    server_id = client.post("/api/mcp/packs/huggingface", headers=HEADERS, json={}).get_json()["data"]["id"]
    assert client.post("/api/mcp/packs/huggingface/signin/reuse", headers=HEADERS, json={}).get_json()["error"]["code"] == "INVALID_REQUEST"
    monkeypatch.setattr(signin, "_local_hf_token", lambda: "hf_local")
    assert hf_pack(client)["signin"]["reusable_login"] == "grace"
    used = client.post("/api/mcp/packs/huggingface/signin/reuse", headers=HEADERS, json={}).get_json()["data"]
    assert used["signed_in"] is True and used["login"] == "grace"
    assert mcp_config.read_secrets("local:me", server_id)["signin_source"] == "local"
    # Logging in again locally (hf auth login) gives the toolkit the new token too.
    monkeypatch.setattr(signin, "_local_hf_token", lambda: "hf_local2")
    signin.prepare("local:me", mcp_config.get_server(server_id))
    assert mcp_config.read_secrets("local:me", server_id)["env"] == {"HF_TOKEN": "hf_local2"}


def test_a_pasted_token_is_a_sign_in_with_its_account(api):
    from data_formulator.mcp_servers import config as mcp_config

    client, _, _, _ = api
    server_id = client.post("/api/mcp/packs/huggingface", headers=HEADERS, json={"settings": {"hf_token": "hf_pasted"}}).get_json()["data"]["id"]
    assert hf_pack(client)["signin"]["signed_in"] is True and hf_pack(client)["signin"]["login"] == "linus"
    client.put("/api/mcp/packs/huggingface/settings", headers=HEADERS, json={"settings": {"hf_token": ""}})
    assert hf_pack(client)["signin"]["signed_in"] is False
    assert "signin_login" not in mcp_config.read_secrets("local:me", server_id)
