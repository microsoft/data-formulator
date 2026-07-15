"""Shared exception inspection for MCP SDK task-group cleanup."""

from __future__ import annotations


def contains_exception(
    exception: BaseException,
    expected_type: type[BaseException] | tuple[type[BaseException], ...],
) -> bool:
    """Return whether an exception group contains the expected type."""
    if isinstance(exception, expected_type):
        return True
    if isinstance(exception, BaseExceptionGroup):
        return any(
            contains_exception(nested, expected_type)
            for nested in exception.exceptions
        )
    return False
