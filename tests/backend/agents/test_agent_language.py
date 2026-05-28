# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Unit tests for data_formulator.agents.agent_language.

Covers:
- build_language_instruction: English returns empty string, non-English
  returns a non-empty instruction, mode='compact' vs mode='full',
  unknown language codes, empty/None input, extra rules injection (zh/ja).
- inject_language_instruction: appending, marker-based insertion,
  empty instruction is a no-op, marker not found falls back to append.
- LANGUAGE_DISPLAY_NAMES and LANGUAGE_EXTRA_RULES registry sanity.
"""

from __future__ import annotations

import pytest

from data_formulator.agents.agent_language import (
    LANGUAGE_DISPLAY_NAMES,
    LANGUAGE_EXTRA_RULES,
    DEFAULT_LANGUAGE,
    build_language_instruction,
    inject_language_instruction,
)

pytestmark = [pytest.mark.backend]


# ---------------------------------------------------------------------------
# LANGUAGE_DISPLAY_NAMES registry
# ---------------------------------------------------------------------------

class TestLanguageRegistry:
    def test_english_in_registry(self):
        assert "en" in LANGUAGE_DISPLAY_NAMES

    def test_common_languages_present(self):
        for lang in ["zh", "ja", "ko", "fr", "de", "es", "pt"]:
            assert lang in LANGUAGE_DISPLAY_NAMES, f"{lang!r} missing from LANGUAGE_DISPLAY_NAMES"

    def test_display_names_are_non_empty_strings(self):
        for code, name in LANGUAGE_DISPLAY_NAMES.items():
            assert isinstance(name, str) and name.strip(), \
                f"Display name for {code!r} is blank or not a string"

    def test_default_language_is_en(self):
        assert DEFAULT_LANGUAGE == "en"

    def test_extra_rules_values_are_strings(self):
        for code, rule in LANGUAGE_EXTRA_RULES.items():
            assert isinstance(rule, str), f"Extra rule for {code!r} is not a string"

    def test_extra_rules_codes_are_subset_of_display_names(self):
        """Every code that has extra rules must also have a display name."""
        for code in LANGUAGE_EXTRA_RULES:
            assert code in LANGUAGE_DISPLAY_NAMES, \
                f"{code!r} has extra rules but no display name"


# ---------------------------------------------------------------------------
# build_language_instruction — English / empty input
# ---------------------------------------------------------------------------

class TestBuildLanguageInstructionEnglish:
    def test_english_returns_empty_string(self):
        assert build_language_instruction("en") == ""

    def test_english_compact_also_returns_empty(self):
        assert build_language_instruction("en", mode="compact") == ""

    def test_empty_string_defaults_to_en_returns_empty(self):
        assert build_language_instruction("") == ""

    def test_none_coerced_to_default_returns_empty(self):
        # None is cast via (language or DEFAULT_LANGUAGE) — equivalent to "en"
        assert build_language_instruction(None) == ""  # type: ignore[arg-type]

    def test_whitespace_only_returns_empty(self):
        assert build_language_instruction("   ") == ""

    def test_case_insensitive_en(self):
        assert build_language_instruction("EN") == ""
        assert build_language_instruction("En") == ""


# ---------------------------------------------------------------------------
# build_language_instruction — non-English, full mode
# ---------------------------------------------------------------------------

class TestBuildLanguageInstructionFull:
    @pytest.mark.parametrize("lang", ["zh", "ja", "ko", "fr", "de", "es"])
    def test_non_english_returns_non_empty(self, lang):
        result = build_language_instruction(lang)
        assert result, f"Expected non-empty instruction for {lang!r}"

    def test_result_contains_language_marker(self):
        result = build_language_instruction("zh")
        assert "[LANGUAGE INSTRUCTION]" in result

    def test_result_contains_display_name(self):
        result = build_language_instruction("zh")
        assert "Simplified Chinese" in result

    def test_full_mode_is_default(self):
        assert build_language_instruction("zh") == build_language_instruction("zh", mode="full")

    def test_full_mode_mentions_user_visible_fields(self):
        result = build_language_instruction("ja")
        assert "title" in result
        assert "display_instruction" in result

    def test_full_mode_mentions_internal_fields(self):
        result = build_language_instruction("fr")
        assert "output_variable" in result or "JSON" in result

    def test_zh_extra_rules_injected(self):
        result = build_language_instruction("zh")
        assert "Simplified Chinese" in result
        assert "Traditional" in result  # warns not to use Traditional Chinese

    def test_ja_extra_rules_injected(self):
        result = build_language_instruction("ja")
        assert "です" in result or "ます" in result

    def test_lang_without_extra_rules_has_no_extra_block(self):
        """Languages without LANGUAGE_EXTRA_RULES should not error."""
        # French has no extra rules
        result = build_language_instruction("fr")
        assert result  # just must not be empty and must not raise


# ---------------------------------------------------------------------------
# build_language_instruction — compact mode
# ---------------------------------------------------------------------------

class TestBuildLanguageInstructionCompact:
    def test_compact_returns_non_empty_for_non_english(self):
        result = build_language_instruction("zh", mode="compact")
        assert result

    def test_compact_contains_language_marker(self):
        result = build_language_instruction("zh", mode="compact")
        assert "[LANGUAGE INSTRUCTION]" in result

    def test_compact_shorter_than_full(self):
        full = build_language_instruction("zh", mode="full")
        compact = build_language_instruction("zh", mode="compact")
        assert len(compact) < len(full)

    def test_compact_mentions_display_instruction(self):
        result = build_language_instruction("ko", mode="compact")
        assert "display_instruction" in result

    def test_compact_instructs_english_for_code(self):
        result = build_language_instruction("de", mode="compact")
        assert "English" in result

    def test_compact_zh_extra_rules_present(self):
        result = build_language_instruction("zh", mode="compact")
        assert "Simplified" in result


# ---------------------------------------------------------------------------
# build_language_instruction — unknown language codes
# ---------------------------------------------------------------------------

class TestBuildLanguageInstructionUnknown:
    def test_unknown_code_returns_non_empty(self):
        """An unknown code should still produce some instruction (graceful degradation)."""
        result = build_language_instruction("xx")
        assert result  # should not be empty since "xx" != "en"

    def test_unknown_code_uses_raw_code_as_display_name(self):
        result = build_language_instruction("xx")
        # When not in LANGUAGE_DISPLAY_NAMES, the code itself is used as name
        assert "xx" in result


# ---------------------------------------------------------------------------
# inject_language_instruction
# ---------------------------------------------------------------------------

class TestInjectLanguageInstruction:
    BASE = "You are a helpful assistant.\n[RULES]\nFollow the rules."
    INSTRUCTION = "[LANGUAGE INSTRUCTION]\nRespond in French."

    def test_empty_instruction_is_noop(self):
        result = inject_language_instruction(self.BASE, "")
        assert result == self.BASE

    def test_non_empty_instruction_appended_by_default(self):
        result = inject_language_instruction(self.BASE, self.INSTRUCTION)
        assert result.endswith(self.INSTRUCTION)
        assert result.startswith("You are a helpful assistant.")

    def test_instruction_appended_after_base(self):
        result = inject_language_instruction("base prompt", "language block")
        assert result == "base prompt\n\nlanguage block"

    def test_marker_found_inserts_before_marker(self):
        result = inject_language_instruction(self.BASE, self.INSTRUCTION, marker="[RULES]")
        # Instruction should appear before "[RULES]"
        idx_instr = result.index(self.INSTRUCTION)
        idx_rules = result.index("[RULES]")
        assert idx_instr < idx_rules

    def test_marker_not_found_falls_back_to_append(self):
        result = inject_language_instruction(self.BASE, self.INSTRUCTION, marker="[NONEXISTENT]")
        assert result.endswith(self.INSTRUCTION)

    def test_marker_at_start_of_string_not_inserted(self):
        """If marker is at position 0, idx > 0 is False, so fallback to append."""
        result = inject_language_instruction("[RULES]\nrest", self.INSTRUCTION, marker="[RULES]")
        # marker at 0 → append
        assert result.endswith(self.INSTRUCTION)

    def test_original_prompt_is_preserved_in_output(self):
        result = inject_language_instruction(self.BASE, self.INSTRUCTION)
        assert self.BASE in result

    def test_marker_insertion_preserves_rest_of_prompt(self):
        result = inject_language_instruction(self.BASE, self.INSTRUCTION, marker="[RULES]")
        assert "[RULES]" in result
        assert "Follow the rules." in result

    def test_round_trip_with_build_and_inject(self):
        """build_language_instruction + inject_language_instruction integration."""
        instruction = build_language_instruction("zh")
        base = "System prompt here.\n[BEGIN]\nDo things."
        result = inject_language_instruction(base, instruction, marker="[BEGIN]")
        assert "Simplified Chinese" in result
        assert "[BEGIN]" in result
        assert "Do things." in result
