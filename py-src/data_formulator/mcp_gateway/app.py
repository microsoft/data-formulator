"""Stateless FastMCP application for the governed gateway."""

from __future__ import annotations

from mcp.server.auth.provider import TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.responses import JSONResponse

from data_formulator.mcp_gateway.auth import GatewayAuthConfig, GatewayTokenVerifier


def create_gateway(
    *,
    token_verifier: TokenVerifier | None = None,
    auth_config: GatewayAuthConfig | None = None,
) -> FastMCP:
    """Create the gateway without registering unapproved source tools."""
    if (token_verifier is None) != (auth_config is None):
        raise ValueError("token_verifier and auth_config must be supplied together")

    gateway = FastMCP(
        "data-formulator-governed-gateway",
        instructions="Expose only approved, read-only Data Formulator operations.",
        stateless_http=True,
        token_verifier=token_verifier,
        auth=(
            AuthSettings(
                issuer_url=auth_config.issuer,
                resource_server_url=auth_config.resource_server_url,
            )
            if auth_config is not None
            else None
        ),
    )

    @gateway.tool()
    def health() -> dict[str, str]:
        """Return the gateway readiness state without contacting an upstream source."""
        return {"status": "ok", "profile_version": "v1"}

    return gateway


def create_production_gateway() -> FastMCP:
    """Create an authenticated gateway from the dedicated deployment settings."""
    auth_config = GatewayAuthConfig.from_environment()
    return create_gateway(
        token_verifier=GatewayTokenVerifier(auth_config),
        auth_config=auth_config,
    )


def create_asgi_app(gateway: FastMCP) -> Starlette:
    """Create the deployable MCP application with a separate health route."""
    app = gateway.streamable_http_app()

    async def health(_request: object) -> JSONResponse:
        return JSONResponse({"status": "ok", "profile_version": "v1"})

    app.add_route("/health", health, methods=["GET"])
    return app
