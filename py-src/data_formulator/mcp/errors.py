"""Safe validation errors for governed MCP profile configuration."""

from __future__ import annotations


class McpProfileValidationError(ValueError):
    """Raised when an administrator-owned MCP profile is invalid."""


class McpProfileNotFoundError(LookupError):
    """Raised when a caller requests a profile absent from the registry."""


class McpGovernedSourceNotFoundError(LookupError):
    """Raised when a caller requests an unavailable governed source."""


class McpGatewayAuthenticationError(PermissionError):
    """Raised when the gateway cannot authenticate its caller safely."""


class McpCapabilityDriftError(RuntimeError):
    """Raised when an upstream MCP server no longer matches its approved profile."""


class McpUpstreamUnavailableError(RuntimeError):
    """Raised when an approved upstream MCP server cannot be reached safely."""


class McpOperationValidationError(ValueError):
    """Raised when a caller request exceeds an approved MCP profile contract."""


class McpOperationCancelledError(RuntimeError):
    """Raised when a caller cancels an MCP operation before completion."""


class McpApprovalRequiredError(PermissionError):
    """Raised when a fixed MCP operation requires user confirmation."""


class McpResultValidationError(ValueError):
    """Raised when an upstream MCP result exceeds the approved result contract."""
