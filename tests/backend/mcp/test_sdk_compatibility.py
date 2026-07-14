"""Local compatibility checks for the approved MCP Python SDK."""

from __future__ import annotations

import asyncio
from datetime import timedelta

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.fastmcp import FastMCP

pytestmark = [pytest.mark.backend]


def test_stateless_server_supports_initialize_tool_listing_and_calls():
    server = FastMCP("compatibility", stateless_http=True)

    @server.tool()
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app = server.streamable_http_app()

    async def probe() -> tuple[set[str], str, str]:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
                headers={"Authorization": "Bearer test-token"},
                timeout=timedelta(seconds=5),
            ) as http_client:
                async with streamable_http_client(
                    "http://localhost:8000/mcp", http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        tools = await session.list_tools()
                        result = await session.call_tool("health", {})
                        return (
                            {tool.name for tool in tools.tools},
                            result.content[0].text,
                            http_client.headers["Authorization"],
                        )

    tool_names, result_text, authorization_header = asyncio.run(probe())

    assert tool_names == {"health"}
    assert "ok" in result_text
    assert authorization_header == "Bearer test-token"


def test_client_cancellation_returns_before_stateless_tool_completes():
    server = FastMCP("cancellation", stateless_http=True)
    started = asyncio.Event()
    completed = asyncio.Event()

    @server.tool()
    async def complete_after_client_cancellation() -> dict[str, str]:
        started.set()
        await asyncio.sleep(0.05)
        completed.set()
        return {"status": "complete"}

    app = server.streamable_http_app()

    async def probe() -> bool:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://localhost:8000",
                timeout=timedelta(seconds=5),
            ) as http_client:
                async with streamable_http_client(
                    "http://localhost:8000/mcp", http_client=http_client
                ) as (read_stream, write_stream, _get_session_id):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        call = asyncio.create_task(
                            session.call_tool("complete_after_client_cancellation", {})
                        )
                        await asyncio.wait_for(started.wait(), timeout=1)
                        call.cancel()
                        with pytest.raises(asyncio.CancelledError):
                            await call
                        await asyncio.wait_for(completed.wait(), timeout=1)
                        return completed.is_set()

    assert asyncio.run(probe())
