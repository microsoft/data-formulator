"""Administrator-owned registry for validated governed MCP profiles."""

from __future__ import annotations

from collections.abc import Iterable

from data_formulator.mcp.errors import (
    McpProfileNotFoundError,
    McpProfileValidationError,
)
from data_formulator.mcp.profile import McpServerProfile


class McpProfileRegistry:
    """Resolve only profiles supplied during gateway startup."""

    def __init__(self, profiles: Iterable[McpServerProfile]) -> None:
        self._profiles: dict[str, McpServerProfile] = {}
        for profile in profiles:
            if profile.profile_id in self._profiles:
                raise McpProfileValidationError("duplicate MCP profile identifier")
            self._profiles[profile.profile_id] = profile

    def get(self, profile_id: str) -> McpServerProfile:
        try:
            return self._profiles[profile_id]
        except KeyError as exc:
            raise McpProfileNotFoundError("MCP profile is not configured") from exc
