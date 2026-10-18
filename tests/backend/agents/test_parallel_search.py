"""Exercise data-loading web tools through the MCP HTTP transport and agent loop.

The model is scripted and HTTP responses are deterministic; no model or search
credentials, Flask application, or external services are needed.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from data_formulator.agents import parallel_search
from data_formulator.agents.agent_data_loading_chat import DataLoadingAgent

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


def _chunk(name=None, args=None, text=None):
    tool_calls = None if name is None else [SimpleNamespace(
        index=0, id="call_search", function=SimpleNamespace(name=name, arguments=json.dumps(args))) ]
    return SimpleNamespace(choices=[SimpleNamespace(
        delta=SimpleNamespace(content=text, tool_calls=tool_calls), finish_reason=None)])


class TestAgentCaller:
    def test_normal_dispatch_and_downstream_model_consumption(self, server):
        calls = []

        class Client:
            model = "scripted-model"

            def get_completion_with_tools(self, messages, **kwargs):
                calls.append(kwargs)
                if len(calls) == 1:
                    assert {"web_search", "web_fetch"} <= {t["function"]["name"] for t in kwargs["tools"]}
                    return iter([_chunk("web_search", SEARCH)])
                tool_result = json.loads(messages[-1]["content"])
                assert SOURCE_URL in tool_result["content"]
                assert tool_result["untrusted"] is True
                return iter([_chunk(text=f"Dataset source: {SOURCE_URL}")])

        workspace = SimpleNamespace(confined_root=None, confined_scratch=None, prune_scratch=lambda: None)
        agent = DataLoadingAgent(Client(), workspace)
        messages = [{"role": "user", "content": "Find public population data"}]
        text = []
        events = list(agent._agentic_loop(messages, text, [], 3))
        assert len(calls) == 2
        assert SOURCE_URL in "".join(text)
        assert any(e["type"] == "tool_result" and e["tool"] == "web_search" for e in events)
        assert server.requests

    def test_fetch_dispatch_and_result_consumption(self, server, monkeypatch):
        monkeypatch.setattr("socket.getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 0))])
        calls = []

        class Client:
            model = "scripted-model"

            def get_completion_with_tools(self, messages, **kwargs):
                calls.append(kwargs)
                if len(calls) == 1:
                    return iter([_chunk("web_fetch", {"urls": [SOURCE_URL]})])
                assert SOURCE_URL in json.loads(messages[-1]["content"])["content"]
                return iter([_chunk(text="The public page describes annual population counts.")])

        agent = DataLoadingAgent(Client(), SimpleNamespace(prune_scratch=lambda: None))
        text = []
        list(agent._agentic_loop([], text, [], 3))
        assert len(calls) == 2 and "annual population" in "".join(text)
        assert any(body.get("params", {}).get("name") == "web_fetch" for _, body in server.requests)

    def test_disabled_search_is_hidden_and_dispatch_is_denied(self, server, monkeypatch):
        monkeypatch.setenv("DF_WEB_SEARCH_ENABLED", "false")

        class Client:
            model = "scripted-model"

            def get_completion_with_tools(self, messages, **kwargs):
                names = {t["function"]["name"] for t in kwargs["tools"]}
                assert not names & {"web_search", "web_fetch"}
                assert {"find_data", "fetch_url"} <= names

        agent = DataLoadingAgent(Client(), None)
        agent._call_llm([])
        assert "error" in agent._execute_tool("web_search", SEARCH)
        assert "error" in parallel_search.call_tool("web_fetch", {"urls": [SOURCE_URL]})
        assert not server.requests

    def test_closing_loop_at_tool_start_does_not_run_search(self, server):
        class Client:
            model = "scripted-model"

            def get_completion_with_tools(self, *a, **k):
                return iter([_chunk("web_search", SEARCH)])

        agent = DataLoadingAgent(Client(), None)
        loop = agent._agentic_loop([], [], [], 3)
        assert next(loop)["type"] == "tool_start"
        loop.close()
        assert not server.requests
