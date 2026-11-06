"""The GitHub tool pack: its read-only, public-only tools, and click-to-sign-in that keeps the token in the vault.

Offline: GitHub is a mock transport (the tools) or patched ``requests`` calls (the sign-in), and time is a fake clock.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
import pytest

from data_formulator.auth import github_device_flow
from data_formulator.tool_packs.github import server

pytestmark = [pytest.mark.backend]


def make_client(handler, tmp_path: Path | None = None, token: str | None = None):
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    return server.Client(tmp_path, token, transport=httpx.MockTransport(record)), requests


def repo(name: str, private: bool = False) -> dict:
    return {"full_name": name, "private": private, "description": "d", "stargazers_count": 5, "forks_count": 1,
            "open_issues_count": 0, "language": "Python", "topics": ["viz"], "license": {"spdx_id": "MIT"},
            "created_at": "2020-01-02T00:00:00Z", "pushed_at": "2026-10-01T00:00:00Z", "archived": False,
            "html_url": f"https://github.com/{name}", "default_branch": "main"}


def test_searches_return_public_repositories_only(monkeypatch, tmp_path):
    reply = {"total_count": 2, "items": [repo("acme/open"), repo("acme/secret", private=True)]}
    client, requests = make_client(lambda request: httpx.Response(200, json=reply), tmp_path, token="tok")
    monkeypatch.setattr(server, "_client", client)
    found = server.search_repositories("viz language:python", sort="stars", limit=200)
    assert [row["repository"] for row in found["repositories"]] == ["acme/open"]
    params = requests[0].url.params
    assert params["q"] == "viz language:python" and params["sort"] == "stars" and params["per_page"] == "50"
    # The token goes in a header, never in the URL or the cache.
    assert requests[0].headers["authorization"] == "Bearer tok" and "tok" not in str(requests[0].url)
    server.search_repositories("viz language:python", sort="stars", limit=200)
    assert len(requests) == 1
    assert not any("tok" in path.read_text() for path in tmp_path.glob("*.json"))


def test_issues_code_details_and_files(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/search/issues":
            return httpx.Response(200, json={"total_count": 1, "items": [{
                "repository_url": "https://api.github.com/repos/vega/vega-lite", "number": 7, "title": "Legend", "state": "open",
                "user": {"login": "ada"}, "labels": [{"name": "bug"}], "comments": 2, "created_at": "2026-01-01T00:00:00Z"}]})
        if path == "/repos/acme/open":
            return httpx.Response(200, json=repo("acme/open"))
        if path == "/repos/acme/secret":
            return httpx.Response(200, json=repo("acme/secret", private=True))
        if path == "/repos/acme/open/readme":
            return httpx.Response(200, content=b"# Open\n")
        if path == "/repos/acme/open/contents/src/app.py":
            return httpx.Response(200, content=b"print('hi')\n")
        if path == "/repos/acme/open/contents/src":
            return httpx.Response(200, content=b'[{"name": "app.py"}]')
        return httpx.Response(404, json={"message": "Not Found"})

    client, requests = make_client(handler)
    monkeypatch.setattr(server, "_client", client)
    issues = server.search_issues("legend", repo="https://github.com/vega/vega-lite", state="open")
    assert issues["query"] == "legend is:issue repo:vega/vega-lite state:open"
    assert issues["results"][0] == {"repository": "vega/vega-lite", "number": 7, "title": "Legend", "state": "open", "author": "ada",
                                    "labels": "bug", "comments": 2, "created": "2026-01-01", "closed": None,
                                    "url": None}
    details = server.repo_details("acme/open")
    assert details["readme"] == "# Open\n" and details["stars"] == 5
    assert requests[-1].headers["accept"] == "application/vnd.github.raw+json"
    assert server.read_file("acme/open", "/src/./app.py")["text"] == "print('hi')\n"
    with pytest.raises(server.GitHubError, match="'..'"):
        server.read_file("acme/open", "src/../secret.py")
    with pytest.raises(server.GitHubError, match="folder"):
        server.read_file("acme/open", "src")
    # A private repository is out of reach, whatever the token could read.
    with pytest.raises(server.GitHubError, match="public repositories only"):
        server.repo_details("acme/secret")
    with pytest.raises(server.GitHubError, match="public repositories only"):
        server.read_file("acme/missing", "x.py")
    with pytest.raises(server.GitHubError, match="owner/name"):
        server.repo_details("not a repo")
    # Code search needs a sign-in.
    with pytest.raises(server.GitHubError, match="sign-in"):
        server.search_code("FlintChart")


def test_rate_limits_and_a_revoked_sign_in_are_explained(monkeypatch):
    limited, _ = make_client(lambda request: httpx.Response(403, headers={"x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999"},
                                                            json={"message": "API rate limit exceeded"}))
    monkeypatch.setattr(server, "_client", limited)
    with pytest.raises(server.GitHubError, match="rate-limiting.*Signing in"):
        server.search_repositories("viz")
    revoked, _ = make_client(lambda request: httpx.Response(401, json={"message": "Bad credentials"}), token="old")
    monkeypatch.setattr(server, "_client", revoked)
    with pytest.raises(server.GitHubError, match="sign in to the GitHub toolkit again"):
        server.search_repositories("viz")


# -- the pack: click-to-sign-in --

HEADERS = {"Origin": "http://localhost", "X-DF-Configuration": "1"}


@pytest.fixture
def api(tmp_path, monkeypatch):
    import flask

    from data_formulator.error_handler import register_error_handlers
    from data_formulator.mcp_servers.routes import mcp_bp

    monkeypatch.setenv("DATA_FORMULATOR_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("CREDENTIAL_VAULT", "local")
    monkeypatch.setattr("data_formulator.auth.identity.is_local_mode", lambda: True)
    monkeypatch.setattr("data_formulator.configuration.user_connectors_disabled", lambda: False)
    clock = [1000.0]
    monkeypatch.setattr(github_device_flow.time, "time", lambda: clock[0])
    app = flask.Flask(__name__)
    app.register_blueprint(mcp_bp)
    register_error_handlers(app)
    with patch("data_formulator.auth.identity.get_identity_id", return_value="local:me"):
        yield app.test_client(), clock


def github_pack(client) -> dict:
    return next(pack for pack in client.get("/api/mcp/packs").get_json()["data"]["packs"] if pack["id"] == "github")


def test_signing_in_keeps_the_token_in_the_vault_for_the_server(api, monkeypatch):
    from data_formulator.mcp_servers import config as mcp_config

    client, clock = api
    assert github_pack(client)["signin"] == {"provider": "github", "signed_in": False, "login": None, "reusable_login": None}
    reply = client.post("/api/mcp/packs/github/signin/start", headers=HEADERS, json={}).get_json()
    assert reply["error"]["code"] == "INVALID_REQUEST"  # add the toolkit first
    server_id = client.post("/api/mcp/packs/github", headers=HEADERS, json={}).get_json()["data"]["id"]

    posts = Mock(side_effect=[
        Mock(status_code=200, json=lambda: {"device_code": "private-device", "user_code": "ABCD-1234",
                                            "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 5}),
        Mock(status_code=200, json=lambda: {"error": "authorization_pending"}),
        Mock(status_code=200, json=lambda: {"access_token": "gho_public"}),
    ])
    monkeypatch.setattr(github_device_flow.http, "post", posts)
    monkeypatch.setattr(github_device_flow.http, "get", Mock(return_value=Mock(status_code=200, json=lambda: {"login": "ada"})))
    started = client.post("/api/mcp/packs/github/signin/start", headers=HEADERS, json={}).get_json()["data"]
    assert started["user_code"] == "ABCD-1234" and "private-device" not in json.dumps(started)
    # No scopes: the token reads public data only.
    assert posts.call_args_list[0].kwargs["json"]["scope"] == ""
    clock[0] += 5
    pending = client.post("/api/mcp/packs/github/signin/poll", headers=HEADERS, json={"flow_id": started["flow_id"]}).get_json()["data"]
    assert pending["flow"]["status"] == "pending" and pending["signed_in"] is False
    clock[0] += 5
    done = client.post("/api/mcp/packs/github/signin/poll", headers=HEADERS, json={"flow_id": started["flow_id"]}).get_json()["data"]
    assert done["flow"]["status"] == "connected" and done["signed_in"] is True and done["login"] == "ada"
    assert "gho_public" not in json.dumps(done)
    assert mcp_config.read_secrets("local:me", server_id)["env"] == {"GITHUB_TOKEN": "gho_public"}
    assert github_pack(client)["signin"]["login"] == "ada"

    out = client.post("/api/mcp/packs/github/signout", headers=HEADERS, json={}).get_json()["data"]
    assert out["signed_in"] is False and "env" not in mcp_config.read_secrets("local:me", server_id)


def test_the_github_copilot_sign_in_can_be_used_as_it_is(api, monkeypatch):
    from data_formulator.auth.vault import get_credential_vault
    from data_formulator.mcp_servers import config as mcp_config

    client, _ = api
    server_id = client.post("/api/mcp/packs/github", headers=HEADERS, json={}).get_json()["data"]["id"]
    assert client.post("/api/mcp/packs/github/signin/reuse", headers=HEADERS, json={}).get_json()["error"]["code"] == "INVALID_REQUEST"
    get_credential_vault().store("local:me", "model-connection:github_copilot", {"access_token": "ghu_copilot", "login": "ada"})
    assert github_pack(client)["signin"]["reusable_login"] == "ada"
    monkeypatch.setattr(github_device_flow.http, "get", Mock(return_value=Mock(status_code=200, json=lambda: {"login": "ada"})))
    used = client.post("/api/mcp/packs/github/signin/reuse", headers=HEADERS, json={}).get_json()["data"]
    assert used["signed_in"] is True and used["login"] == "ada" and used["reusable_login"] is None
    assert mcp_config.read_secrets("local:me", server_id)["env"] == {"GITHUB_TOKEN": "ghu_copilot"}
