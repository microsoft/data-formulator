# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Bounded, optimistic text editing for workspace content."""

from __future__ import annotations

import hashlib
import hmac
from typing import Any

MAX_TEXT_EDIT_OPERATIONS = 100


class TextEditConflictError(ValueError):
    """Raised when text no longer matches the caller's expected version."""


def text_content_hash(content: str) -> str:
    """Return the canonical SHA-256 hash for UTF-8 text."""
    if not isinstance(content, str):
        raise ValueError("Text content must be a string")
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def apply_text_patch(
    content: str,
    *,
    expected_content_hash: str,
    replacements: list[dict[str, Any]] | None = None,
    append_text: str | None = None,
    max_chars: int,
) -> str:
    """Apply bounded exact replacements and append text to a known version."""
    if not isinstance(content, str):
        raise ValueError("Text content must be a string")
    if not isinstance(expected_content_hash, str) or not expected_content_hash:
        raise ValueError("expected_content_hash must be a non-empty string")
    if not isinstance(max_chars, int) or isinstance(max_chars, bool) or max_chars < 1:
        raise ValueError("max_chars must be a positive integer")
    if len(content) > max_chars:
        raise ValueError(f"Text content exceeds {max_chars} characters")
    if not hmac.compare_digest(text_content_hash(content), expected_content_hash):
        raise TextEditConflictError("Text changed while patching")

    edits = [] if replacements is None else replacements
    if not isinstance(edits, list):
        raise ValueError("replacements must be an array")
    if len(edits) > MAX_TEXT_EDIT_OPERATIONS:
        raise ValueError(
            f"Text patch exceeds {MAX_TEXT_EDIT_OPERATIONS} replacement operations"
        )
    if not edits and append_text is None:
        raise ValueError("Patch requires replacements or append_text")

    updated = content
    for replacement in edits:
        if not isinstance(replacement, dict):
            raise ValueError("Each replacement must be an object")
        unsupported = set(replacement) - {"old_text", "new_text", "replace_all"}
        if unsupported:
            raise ValueError(f"Unsupported replacement fields: {sorted(unsupported)}")
        old_text = replacement.get("old_text")
        new_text = replacement.get("new_text")
        replace_all = replacement.get("replace_all", False)
        if not isinstance(old_text, str) or not old_text:
            raise ValueError("replacement.old_text must be a non-empty string")
        if not isinstance(new_text, str):
            raise ValueError("replacement.new_text must be a string")
        if not isinstance(replace_all, bool):
            raise ValueError("replacement.replace_all must be a boolean")
        if len(old_text) > max_chars or len(new_text) > max_chars:
            raise ValueError("Replacement text exceeds the configured text limit")

        matches = updated.count(old_text)
        if matches == 0:
            raise ValueError("replacement.old_text was not found")
        if matches > 1 and not replace_all:
            raise ValueError(
                "replacement.old_text is ambiguous; provide more context or set replace_all"
            )
        replaced_count = matches if replace_all else 1
        projected_length = len(updated) + replaced_count * (len(new_text) - len(old_text))
        if projected_length > max_chars:
            raise ValueError(f"Patched text exceeds {max_chars} characters")
        updated = updated.replace(old_text, new_text, -1 if replace_all else 1)

    if append_text is not None:
        if not isinstance(append_text, str):
            raise ValueError("append_text must be a string")
        if len(updated) + len(append_text) > max_chars:
            raise ValueError(f"Patched text exceeds {max_chars} characters")
        updated += append_text

    return updated