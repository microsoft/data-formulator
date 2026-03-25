# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Language instruction builder for Agent prompts.

Generates a prompt fragment that constrains LLM output language for
user-visible fields while keeping all internal / programmatic fields
stable in English.

Two modes are provided:

- **"full"** — detailed field-by-field rules for text-heavy agents
  (ChartInsight, InteractiveExplore, ReportGen, CodeExplanation,
  DataClean, DataAgent).
- **"compact"** — a short 3-sentence instruction for code-generation
  agents (DataRec, DataTransformation, DataLoad) so that the extra
  text does not distract the model from writing correct code.

Usage:
    from data_formulator.agents.agent_language import build_language_instruction

    instruction = build_language_instruction("zh")              # full (default)
    instruction = build_language_instruction("zh", mode="compact")  # compact
    instruction = build_language_instruction("en")              # returns ""
"""

# ── Language registry ───────────────────────────────────────

LANGUAGE_DISPLAY_NAMES: dict[str, str] = {
    "en": "English",
    "zh": "Simplified Chinese (简体中文)",
    "ja": "Japanese (日本語)",
    "ko": "Korean (한국어)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "es": "Spanish (Español)",
    "pt": "Portuguese (Português)",
    "ru": "Russian (Русский)",
    "ar": "Arabic (العربية)",
    "hi": "Hindi (हिन्दी)",
    "th": "Thai (ไทย)",
    "vi": "Vietnamese (Tiếng Việt)",
    "it": "Italian (Italiano)",
    "nl": "Dutch (Nederlands)",
    "pl": "Polish (Polski)",
    "tr": "Turkish (Türkçe)",
    "id": "Indonesian (Bahasa Indonesia)",
    "ms": "Malay (Bahasa Melayu)",
    "sv": "Swedish (Svenska)",
}

# ── Per-language extra rules ────────────────────────────────

LANGUAGE_EXTRA_RULES: dict[str, str] = {
    "zh": (
        "\n\nAdditional rules for Chinese:\n"
        "- Use Simplified Chinese (简体中文), NOT Traditional Chinese (繁體中文).\n"
        "- Keep technical terms natural: prefer widely-used Chinese equivalents "
        "(e.g., 销售额, 利润率) over awkward literal translations."
    ),
    "ja": (
        "\n\nAdditional rules for Japanese:\n"
        "- Use polite form (です/ます体) in all user-facing text."
    ),
}

DEFAULT_LANGUAGE = "en"


def build_language_instruction(language: str, *, mode: str = "full") -> str:
    """Return a prompt instruction block for the given language code.

    Parameters
    ----------
    language : str
        BCP-47 primary subtag, e.g. ``"zh"``, ``"en"``, ``"ja"``.
    mode : ``"full"`` | ``"compact"``
        ``"full"``    – detailed field-level rules (for text-heavy agents).
        ``"compact"`` – minimal instruction (for code-generation agents).

    Returns ``""`` when *language* is ``"en"`` (or empty / unrecognised).
    """
    lang = (language or DEFAULT_LANGUAGE).strip().lower()

    if lang == "en":
        return ""

    display_name = LANGUAGE_DISPLAY_NAMES.get(lang, lang)
    extra = LANGUAGE_EXTRA_RULES.get(lang, "")

    if mode == "compact":
        return _build_compact(display_name, extra)
    return _build_full(display_name, extra)


# ── Compact instruction (code-generation agents) ──────────

def _build_compact(display_name: str, extra: str) -> str:
    return (
        "[LANGUAGE INSTRUCTION]\n"
        f"Write `display_instruction` and `suggested_table_name` in {display_name}. "
        "All other JSON fields, Python code, variable names, column references, "
        "and comments MUST stay in English. "
        f"Keep original dataset column names exactly as-is — do NOT translate them."
        f"{extra}"
    )


# ── Full instruction (text-heavy agents) ──────────────────

def _build_full(display_name: str, extra: str) -> str:
    return (
        "[LANGUAGE INSTRUCTION]\n"
        "\n"
        f"The user's interface language is **{display_name}**.\n"
        "\n"

        f"**User-visible fields** — MUST be written in {display_name}:\n"
        "\n"
        f"Write these in {display_name}:\n"
        '- `title`  (chart title)\n'
        '- `takeaways`  (chart insight bullet points)\n'
        '- `text`, `goal`, `tag`  (exploration question cards)\n'
        '- `display_instruction`  (short description shown on data thread)\n'
        '- `message`  (clarification questions to the user)\n'
        '- `summary`  (final exploration summary)\n'
        '- `explanation`  (concept / code explanations)\n'
        '- `data_summary`  (dataset description)\n'
        '- `suggested_table_name`  (human-readable table name)\n'
        '- Report markdown output  (entire content)\n'
        '- Any other free-text that the user will read\n'
        "\n"

        "**Internal / programmatic fields** — MUST remain in English:\n"
        '`output_variable`, `output_fields`, `chart_type`, `encodings`, '
        '`config`, `semantic_type`, `field_metadata`, `reason`, '
        '`detailed_instruction`, `thought`, `difficulty`, '
        "all JSON keys, all Python code (variables, column names, comments).\n"
        "\n"

        "**Original dataset column names** — DO NOT translate or rename. "
        "Keep them exactly as-is.\n"
        "\n"

        "**New derived columns** — use English snake_case in code; "
        f"describe them in {display_name} in user-visible text.\n"

        f"{extra}"
    )
