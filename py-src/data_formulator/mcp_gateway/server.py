"""ASGI entry point for the internal MCP gateway container."""

from __future__ import annotations

from data_formulator.mcp_gateway.app import create_asgi_app, create_production_gateway

app = create_asgi_app(create_production_gateway())
