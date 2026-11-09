from __future__ import annotations

import pytest

from data_formulator.datalake.text_edit import (
    MAX_TEXT_EDIT_OPERATIONS,
    apply_text_patch,
    text_content_hash,
)

pytestmark = [pytest.mark.backend]


def test_apply_text_patch_replaces_and_appends() -> None:
    content = "# Notes\n\nOwner: Casey\n"

    updated = apply_text_patch(
        content,
        expected_content_hash=text_content_hash(content),
        replacements=[{"old_text": "Owner: Casey", "new_text": "Owner: Morgan"}],
        append_text="Status: active\n",
        max_chars=1_000,
    )

    assert updated == "# Notes\n\nOwner: Morgan\nStatus: active\n"


def test_apply_text_patch_rejects_stale_hash_and_ambiguous_match() -> None:
    content = "same\nsame\n"

    with pytest.raises(ValueError, match="Text changed while patching"):
        apply_text_patch(
            content,
            expected_content_hash=text_content_hash("older"),
            append_text="new",
            max_chars=1_000,
        )

    with pytest.raises(ValueError, match="ambiguous"):
        apply_text_patch(
            content,
            expected_content_hash=text_content_hash(content),
            replacements=[{"old_text": "same", "new_text": "changed"}],
            max_chars=1_000,
        )


def test_apply_text_patch_rejects_growth_before_replace_all() -> None:
    content = "x" * 100

    with pytest.raises(ValueError, match="Patched text exceeds"):
        apply_text_patch(
            content,
            expected_content_hash=text_content_hash(content),
            replacements=[{
                "old_text": "x",
                "new_text": "y" * 100,
                "replace_all": True,
            }],
            max_chars=1_000,
        )


def test_apply_text_patch_limits_operations_and_fields() -> None:
    content = "a"
    with pytest.raises(ValueError, match="replacements must be an array"):
        apply_text_patch(
            content,
            expected_content_hash=text_content_hash(content),
            replacements={},  # type: ignore[arg-type]
            append_text="b",
            max_chars=1_000,
        )

    with pytest.raises(ValueError, match="replacement operations"):
        apply_text_patch(
            content,
            expected_content_hash=text_content_hash(content),
            replacements=[{"old_text": "a", "new_text": "a"}] * (
                MAX_TEXT_EDIT_OPERATIONS + 1
            ),
            max_chars=1_000,
        )

    with pytest.raises(ValueError, match="Unsupported replacement fields"):
        apply_text_patch(
            content,
            expected_content_hash=text_content_hash(content),
            replacements=[{"old_text": "a", "new_text": "b", "path": "../outside"}],
            max_chars=1_000,
        )