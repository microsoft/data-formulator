"""Exercise the connected-data web tools through the MCP HTTP transport and the skill.

HTTP responses are deterministic; no model or search credentials, Flask
application, or external services are needed.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from data_formulator.analyst.skills import build_registry
from data_formulator.analyst.skills.base import SkillContext
from data_formulator.analyst.skills.connected_data import parallel_search

pytestmark = [pytest.mark.backend]

SEARCH = {"objective": "Find public population data", "search_queries": ["population csv public data"]}
SOURCE_URL = "https://example.org/population.csv"
TEXT = f"Population dataset: {SOURCE_URL} (annual population counts)."


@pytest.fixture
def server(monkeypatch):
    """Use the real MCP SDK, intercepting only the HTTP boundary."""
    monkeypatch.delenv("PARALLEL_API_KEY", raising=False)
    monkeypatch.delenv("DF_WEB_SEARCH_ENABLED", raising=False)
    requests = []
    clients = []
    state = {"text": TEXT, "is_error": False, "http_status": 200}

    async def handle(request):
        body = json.loads(request.content) if request.content else {}
        requests.append((request, body))
        if state["http_status"] != 200:
            return httpx.Response(state["http_status"], text="secret upstream diagnostic")
        method = body.get("method")
        if method == "initialize":
            result = {"protocolVersion": body["params"]["protocolVersion"], "capabilities": {"tools": {}},
                      "serverInfo": {"name": "fixture", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": [{"name": name, "inputSchema": {"type": "object"}}
                                for name in ("web_search", "web_fetch")]}
        elif method == "tools/call":
            if state.get("wait"):
                state["started"].set()
                await asyncio.Event().wait()
            result = {"content": [{"type": "text", "text": state["text"]}], "isError": state["is_error"]}
        else:
            return httpx.Response(202)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"], "result": result})

    client_class = httpx.AsyncClient

    def client(**kwargs):
        result = client_class(transport=httpx.MockTransport(handle), **kwargs)
        clients.append(result)
        return result

    monkeypatch.setattr(parallel_search.httpx, "AsyncClient", client)
    return SimpleNamespace(requests=requests, clients=clients, state=state)


class TestMCPTransport:
    @pytest.mark.parametrize("name,args", [
        ("web_search", SEARCH),
        ("web_fetch", {"urls": [SOURCE_URL], "objective": "Find the units"}),
    ])
    def test_anonymous_requests_and_useful_content(self, server, monkeypatch, name, args):
        # DNS validation is deterministic; the MCP transport is still real.
        monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
        result = parallel_search.call_tool(name, args)
        assert SOURCE_URL in result["content"]
        assert result["untrusted"] is True
        methods = [body.get("method") for _, body in server.requests]
        assert "initialize" in methods and "tools/list" in methods and "tools/call" in methods
        for request, _ in server.requests:
            assert str(request.url) == "https://search.parallel.ai/mcp"
            assert request.headers["user-agent"].startswith("data-formulator/")
            assert "github.com/microsoft/data-formulator" in request.headers["user-agent"]
            assert "authorization" not in request.headers
        call = next(body for _, body in server.requests if body.get("method") == "tools/call")
        assert call["params"]["name"] == name
        assert call["params"]["arguments"] == args
        assert all(client.is_closed for client in server.clients)

    def test_explicit_key_is_preserved(self, server, monkeypatch):
        monkeypatch.setenv("PARALLEL_API_KEY", "configured-test-key")
        parallel_search.call_tool("web_search", SEARCH)
        assert all(r.headers["authorization"] == "Bearer configured-test-key" for r, _ in server.requests)

    @pytest.mark.parametrize("status", [401, 403, 429, 500])
    def test_http_errors_are_safe_and_do_not_fall_back(self, server, status):
        server.state["http_status"] = status
        result = parallel_search.call_tool("web_search", SEARCH)
        assert "error" in result
        assert "secret upstream" not in json.dumps(result)
        assert len(server.requests) == 1
        assert all(client.is_closed for client in server.clients)

    def test_tool_error_is_not_returned_as_success(self, server):
        server.state.update(is_error=True, text="secret upstream diagnostic")
        result = parallel_search.call_tool("web_search", SEARCH)
        assert "error" in result and "secret upstream" not in json.dumps(result)
        assert sum(body.get("method") == "tools/call" for _, body in server.requests) == 1

    def test_authenticated_failure_never_retries_anonymously(self, server, monkeypatch):
        monkeypatch.setenv("PARALLEL_API_KEY", "configured-test-key")
        server.state["http_status"] = 401
        assert "error" in parallel_search.call_tool("web_search", SEARCH)
        assert len(server.requests) == 1
        assert server.requests[0][0].headers["authorization"] == "Bearer configured-test-key"

    def test_large_results_are_bounded_and_marked(self, server):
        server.state["text"] = "x" * (parallel_search.MAX_OUTPUT_CHARS + 100)
        result = parallel_search.call_tool("web_search", SEARCH)
        assert len(result["content"]) == parallel_search.MAX_OUTPUT_CHARS
        assert result["truncated"] is True

    def test_timeout_closes_client(self, server, monkeypatch):
        server.state.update(wait=True, started=asyncio.Event())
        monkeypatch.setattr(parallel_search, "REQUEST_TIMEOUT", 0.05)
        assert "error" in parallel_search.call_tool("web_search", SEARCH)
        assert all(client.is_closed for client in server.clients)

    def test_cancellation_propagates_and_closes_client(self, server):
        async def run():
            server.state.update(wait=True, started=asyncio.Event())
            task = asyncio.create_task(parallel_search._request("web_search", SEARCH))
            await asyncio.wait_for(server.state["started"].wait(), timeout=2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        asyncio.run(run())
        assert all(client.is_closed for client in server.clients)

    @pytest.mark.parametrize("name,args", [
        ("web_search", {"objective": "x", "search_queries": []}),
        ("web_search", {"objective": 4, "search_queries": ["query"]}),
        ("web_search", {"objective": "x", "search_queries": "query"}),
        ("web_search", {**SEARCH, "model_name": "untrusted override"}),
        ("web_fetch", {"urls": ["file:///etc/passwd"]}),
        ("web_fetch", {"urls": ["http://user:password@example.org"]}),
        ("web_fetch", {"urls": []}),
        ("web_fetch", {"urls": [SOURCE_URL], "full_content": True}),
        ("unknown_tool", SEARCH),
    ])
    def test_invalid_arguments_never_contact_provider(self, server, name, args):
        assert "error" in parallel_search.call_tool(name, args)
        assert not server.requests

    def test_private_fetch_url_is_blocked(self, server, monkeypatch):
        monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("127.0.0.1", 0))])
        assert "error" in parallel_search.call_tool("web_fetch", {"urls": ["http://localhost/data"]})
        assert not server.requests


def _skill_context():
    return SkillContext(client=None, workspace=None)


class TestConnectedDataSkill:
    def test_dispatch_returns_the_source_to_the_model(self, server, monkeypatch):
        # DNS validation is deterministic; the MCP transport is still real.
        monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
        skill = build_registry().get_skill("connected_data")
        for name, args in (("web_search", SEARCH), ("web_fetch", {"urls": [SOURCE_URL]})):
            result = json.loads(skill.handle_tool(name, args, _skill_context()).text)
            assert SOURCE_URL in result["content"] and result["untrusted"] is True
        called = [body["params"]["name"] for _, body in server.requests if body.get("method") == "tools/call"]
        assert called == ["web_search", "web_fetch"]

    def test_unknown_tool_is_rejected_before_the_provider(self, server):
        with pytest.raises(ValueError):
            build_registry().get_skill("connected_data").handle_tool("probe_data", SEARCH, _skill_context())
        assert not server.requests

    def test_enabled_policy_exposes_the_tools_and_their_guidance(self):
        registry = build_registry().with_web_search_policy(True)
        assert {spec["function"]["name"] for spec in registry.tools_for(["connected_data"])} == {
            "web_search", "web_fetch",
        }
        body = registry.load_body("connected_data")
        assert "### Public Web Discovery" in body
        assert "`web_search` to find candidate public sources" in body
        assert "{public_web_discovery}" not in body and "{web_discovery_route}" not in body

    def test_disabled_policy_hides_the_tools_and_denies_dispatch(self, server, monkeypatch):
        registry = build_registry().with_web_search_policy(False)
        assert registry.tools_for(["connected_data"]) == []
        assert registry.metas["connected_data"].tool_names == ()
        body = registry.load_body("connected_data")
        assert "web_search" not in body and "{public_web_discovery}" not in body
        # The rest of the acquisition guidance is unaffected.
        assert "## Choose an Acquisition Route" in body
        assert registry.gated_skill_names() == build_registry().gated_skill_names()

        monkeypatch.setenv("DF_WEB_SEARCH_ENABLED", "false")
        assert "error" in parallel_search.call_tool("web_search", SEARCH)
        assert not server.requests


class TestOperatorGate:
    @pytest.mark.parametrize("value,expected", [
        ("true", True), ("1", True), ("YES", True), ("on", True),
        ("false", False), ("0", False), ("anything-else", False),
    ])
    def test_env_var_decides_in_either_deployment(self, monkeypatch, value, expected):
        from data_formulator.configuration import web_search_enabled

        monkeypatch.setenv("DF_WEB_SEARCH_ENABLED", value)
        assert web_search_enabled() is expected

    @pytest.mark.parametrize("preset,expected", [(False, True), (True, False)])
    def test_anonymous_preset_defaults_to_off(self, monkeypatch, preset, expected):
        import flask

        from data_formulator.configuration import web_search_enabled

        monkeypatch.delenv("DF_WEB_SEARCH_ENABLED", raising=False)
        app = flask.Flask(__name__)
        app.config["CLI_ARGS"] = {"web_search_default_off": preset}
        with app.app_context():
            assert web_search_enabled() is expected
