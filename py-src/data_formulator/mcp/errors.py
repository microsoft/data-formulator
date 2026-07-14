"""Safe validation errors for governed MCP profile configuration."""

from __future__ import annotations


class McpProfileValidationError(ValueError):
    """Raised when an administrator-owned MCP profile is invalid."""


class McpProfileNotFoundError(LookupError):
    """Raised when a caller requests a profile absent from the registry."""


class McpGatewayAuthenticationError(PermissionError):
    """Raised when the gateway cannot authenticate its caller safely."""


class McpCapabilityDriftError(RuntimeError):
    """Raised when an upstream MCP server no longer matches its approved profile."""


class McpUpstreamUnavailableError(RuntimeError):
    """Raised when an approved upstream MCP server cannot be reached safely."""
