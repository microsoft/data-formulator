"""Stateless FastMCP application for the governed gateway."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, Protocol

from mcp.server.auth.provider import TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import Context, FastMCP
from starlette.requests import Request
from starlette.applications import Starlette
from starlette.responses import JSONResponse

from data_formulator.mcp.errors import (
    McpApprovalRequiredError,
    McpGatewayAuthenticationError,
    McpOperationValidationError,
    McpProfileValidationError,
)
from data_formulator.mcp.profile import McpOperation, McpSourceReference
from data_formulator.mcp_gateway.approval import McpApprovalRequest
from data_formulator.mcp_gateway.auth import GatewayAuthConfig, GatewayTokenVerifier
from data_formulator.mcp_gateway.contracts import McpOperationResult


class McpGatewayOperationService(Protocol):
    """Execute a fixed product operation using startup-owned configuration."""

    async def execute(
        self,
        *,
        profile_id: str,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> McpOperationResult:
        """Execute one validated product operation."""


class McpGatewayApprovalCoordinator(Protocol):
    """Confirm and execute a fixed pending operation for its authenticated owner."""

    def request_approval(
        self,
        *,
        caller_subject: str,
        profile_id: str,
        operation: McpOperation,
        source_reference: McpSourceReference,
        arguments: dict[str, object],
        operation_id: str,
        page: int,
    ) -> McpApprovalRequest:
        """Store one validated fixed operation for later owner confirmation."""

    async def confirm_and_execute(
        self,
        *,
        caller_subject: str,
        operation_id: str,
    ) -> McpOperationResult:
        """Consume and execute one caller-owned pending operation."""

    def deny(
        self,
        *,
        caller_subject: str,
        operation_id: str,
    ) -> None:
        """Deny one caller-owned pending operation."""


def create_gateway(
    *,
    token_verifier: TokenVerifier | None = None,
    auth_config: GatewayAuthConfig | None = None,
    operation_service: McpGatewayOperationService | None = None,
    approval_coordinator: McpGatewayApprovalCoordinator | None = None,
    caller_subject_provider: Callable[[], str] | None = None,
) -> FastMCP:
    """Create the gateway with only injected, fixed read-operation tools."""
    if (token_verifier is None) != (auth_config is None):
        raise ValueError("token_verifier and auth_config must be supplied together")
    if (approval_coordinator is None) != (caller_subject_provider is None):
        raise ValueError(
            "approval_coordinator and caller_subject_provider must be supplied together"
        )
    if approval_coordinator is not None and operation_service is None:
        raise ValueError("approval_coordinator requires an operation_service")

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

    if operation_service is not None:
        _register_operation_tools(
            gateway,
            operation_service,
            approval_coordinator=approval_coordinator,
            caller_subject_provider=caller_subject_provider,
        )

    return gateway


def create_production_gateway() -> FastMCP:
    """Create an authenticated gateway from the dedicated deployment settings."""
    auth_config = GatewayAuthConfig.from_environment()
    return create_gateway(
        token_verifier=GatewayTokenVerifier(auth_config),
        auth_config=auth_config,
    )


def create_asgi_app(
    gateway: FastMCP,
    *,
    approval_coordinator: McpGatewayApprovalCoordinator | None = None,
    caller_subject_provider: Callable[[], str] | None = None,
) -> Starlette:
    """Create the deployable MCP application with a separate health route."""
    if (approval_coordinator is None) != (caller_subject_provider is None):
        raise ValueError(
            "approval_coordinator and caller_subject_provider must be supplied together"
        )

    app = gateway.streamable_http_app()

    async def health(_request: object) -> JSONResponse:
        return JSONResponse({"status": "ok", "profile_version": "v1"})

    app.add_route("/health", health, methods=["GET"])
    if approval_coordinator is not None and caller_subject_provider is not None:

        async def confirm(
            request: Request,
        ) -> JSONResponse:
            request_identity = await _approval_request_identity(
                request,
                caller_subject_provider,
            )
            if isinstance(request_identity, JSONResponse):
                return request_identity
            operation_id, caller_subject = request_identity

            try:
                result = await approval_coordinator.confirm_and_execute(
                    caller_subject=caller_subject,
                    operation_id=operation_id,
                )
            except McpApprovalRequiredError:
                return _approval_unavailable_response()

            return JSONResponse({
                "status": "success",
                "data": _serialize_operation_result(result),
            })

        app.add_route(
            "/approvals/{operation_id}/confirm",
            confirm,
            methods=["POST"],
        )

        async def deny(
            request: Request,
        ) -> JSONResponse:
            request_identity = await _approval_request_identity(
                request,
                caller_subject_provider,
            )
            if isinstance(request_identity, JSONResponse):
                return request_identity
            operation_id, caller_subject = request_identity

            try:
                approval_coordinator.deny(
                    caller_subject=caller_subject,
                    operation_id=operation_id,
                )
            except McpApprovalRequiredError:
                return _approval_unavailable_response()

            return JSONResponse({
                "status": "success",
                "data": {
                    "operation_id": operation_id,
                    "state": "denied",
                },
            })

        app.add_route(
            "/approvals/{operation_id}/deny",
            deny,
            methods=["POST"],
        )
    return app


async def _approval_request_identity(
    request: Request,
    caller_subject_provider: Callable[[], str],
) -> tuple[str, str] | JSONResponse:
    operation_id = request.path_params.get("operation_id")
    if not isinstance(operation_id, str) or not operation_id:
        return _approval_unavailable_response()
    try:
        caller_subject = caller_subject_provider()
    except McpGatewayAuthenticationError:
        return _approval_error_response(
            status_code=401,
            code="AUTH_REQUIRED",
            message="Authentication is required",
        )
    if await request.body():
        return _approval_unavailable_response()
    return operation_id, caller_subject


def _register_operation_tools(
    gateway: FastMCP,
    operation_service: McpGatewayOperationService,
    *,
    approval_coordinator: McpGatewayApprovalCoordinator | None,
    caller_subject_provider: Callable[[], str] | None,
) -> None:
    async def execute(
        operation: McpOperation,
        *,
        profile_id: str,
        source_reference: Mapping[str, object],
        arguments: dict[str, object],
        operation_id: str,
        context: Context,
        page: int = 1,
    ) -> dict[str, object]:
        await _validate_raw_operation_arguments(context)
        try:
            reference = McpSourceReference.from_dict(dict(source_reference))
        except McpProfileValidationError as exc:
            raise McpOperationValidationError(
                "source reference does not meet the MCP operation contract"
            ) from exc

        try:
            result = await operation_service.execute(
                profile_id=profile_id,
                operation=operation,
                source_reference=reference,
                arguments=arguments,
                operation_id=operation_id,
                page=page,
            )
        except McpApprovalRequiredError:
            if approval_coordinator is None or caller_subject_provider is None:
                raise
            approval_coordinator.request_approval(
                caller_subject=caller_subject_provider(),
                profile_id=profile_id,
                operation=operation,
                source_reference=reference,
                arguments=arguments,
                operation_id=operation_id,
                page=page,
            )
            return {
                "status": "approval_required",
                "operation_id": operation_id,
            }
        return _serialize_operation_result(result)

    @gateway.tool(name="catalog")
    async def catalog(
        profile_id: str,
        source_reference: dict[str, object],
        arguments: dict[str, object],
        operation_id: str,
        context: Context,
        page: int = 1,
    ) -> dict[str, object]:
        """Read the approved source catalog through the operation service."""
        return await execute(
            McpOperation.CATALOG,
            profile_id=profile_id,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
            context=context,
        )

    @gateway.tool(name="schema")
    async def schema(
        profile_id: str,
        source_reference: dict[str, object],
        arguments: dict[str, object],
        operation_id: str,
        context: Context,
        page: int = 1,
    ) -> dict[str, object]:
        """Read the approved source schema through the operation service."""
        return await execute(
            McpOperation.SCHEMA,
            profile_id=profile_id,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
            context=context,
        )

    @gateway.tool(name="semantic_query")
    async def semantic_query(
        profile_id: str,
        source_reference: dict[str, object],
        arguments: dict[str, object],
        operation_id: str,
        context: Context,
        page: int = 1,
    ) -> dict[str, object]:
        """Read approved semantic results through the operation service."""
        return await execute(
            McpOperation.SEMANTIC_QUERY,
            profile_id=profile_id,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
            context=context,
        )

    @gateway.tool(name="bounded_read")
    async def bounded_read(
        profile_id: str,
        source_reference: dict[str, object],
        arguments: dict[str, object],
        operation_id: str,
        context: Context,
        page: int = 1,
    ) -> dict[str, object]:
        """Read bounded source data through the operation service."""
        return await execute(
            McpOperation.BOUNDED_READ,
            profile_id=profile_id,
            source_reference=source_reference,
            arguments=arguments,
            operation_id=operation_id,
            page=page,
            context=context,
        )


def _serialize_operation_result(result: McpOperationResult) -> dict[str, object]:
    return {
        "result_schema_version": "v1",
        "source_reference": {
            "source_id": result.source_reference.source_id,
            "snapshot_id": result.source_reference.snapshot_id,
        },
        "items": [dict(item) for item in result.items],
        "next_page": result.next_page,
    }


def _approval_error_response(
    *,
    status_code: int,
    code: str,
    message: str,
) -> JSONResponse:
    return JSONResponse(
        {
            "status": "error",
            "error": {
                "code": code,
                "message": message,
                "retry": False,
            },
        },
        status_code=status_code,
    )


def _approval_unavailable_response() -> JSONResponse:
    return _approval_error_response(
        status_code=403,
        code="ACCESS_DENIED",
        message="Approval is unavailable",
    )


async def _validate_raw_operation_arguments(context: Context) -> None:
    """Reject fields FastMCP would otherwise silently discard during validation."""
    request = context.request_context.request
    if not isinstance(request, Request):
        raise McpOperationValidationError(
            "MCP operation request does not use the supported transport"
        )
    payload = await request.json()
    params = payload.get("params")
    raw_arguments = params.get("arguments") if isinstance(params, dict) else None
    if not isinstance(raw_arguments, dict):
        raise McpOperationValidationError("MCP operation arguments are invalid")

    allowed_fields = {
        "profile_id",
        "source_reference",
        "arguments",
        "operation_id",
        "page",
    }
    if set(raw_arguments) - allowed_fields:
        raise McpOperationValidationError(
            "MCP operation contains unsupported fields"
        )

    operation_arguments = raw_arguments.get("arguments")
    if not isinstance(operation_arguments, dict):
        raise McpOperationValidationError("MCP operation arguments are invalid")
    prohibited_fields = {"endpoint", "tool", "tool_name", "url"}
    if any(key.lower() in prohibited_fields for key in operation_arguments):
        raise McpOperationValidationError(
            "MCP operation arguments contain a prohibited field"
        )
