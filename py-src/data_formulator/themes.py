# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The user's chart theme library: Flint ``ThemeSpec``s saved under ``<user home>/themes/<id>.json``.

A saved theme is used by id wherever a Flint preset id is: canvas charts, maps,
and apps (``<Page theme="acme">``), in every session of the user. A theme
extends at most one Flint preset and overrides a few parts of it.
"""

from __future__ import annotations

import json
import re
from typing import Any

from data_formulator.security.path_safety import ConfinedDir

THEME_DIR = "themes"
MAX_THEME_CHARS = 40_000
MAX_THEMES = 100
THEME_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
# ThemeSpec's top-level parts (flint-chart src/core/theme/types.ts), and the library's own `description`.
THEME_KEYS = (
    "id", "label", "description", "extends", "ink", "type", "structure", "marks", "labels", "legend", "dataLabels",
    "annotation", "furniture", "source", "facets", "layout", "geometry", "chartDefaults", "compileDefaults",
    "interaction", "variants",
)
LIST_KEYS = ("furniture", "variants")
HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
CSS_COLOR_FUNCTION = re.compile(r"^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(", re.IGNORECASE)


def _color_problems(value: Any, path: str, problems: list[str]) -> None:
    """Flint reads colors as hex: name the strings that look like colors but are not."""
    if isinstance(value, dict):
        for key, item in value.items():
            _color_problems(item, f"{path}.{key}", problems)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _color_problems(item, f"{path}[{index}]", problems)
    elif isinstance(value, str):
        if value.startswith("#") and not HEX_COLOR.match(value):
            problems.append(f"{path} {value!r} is not a hex color (#rgb, #rrggbb, or #rrggbbaa)")
        elif CSS_COLOR_FUNCTION.match(value):
            problems.append(f"{path} {value!r}: write colors as hex (#rrggbb)")


def validate_theme(theme: Any, presets: list[str]) -> dict[str, Any]:
    """The theme, checked; raises ``ValueError`` listing every problem."""
    if not isinstance(theme, dict):
        raise ValueError("Theme not saved: a theme is a JSON object (a Flint ThemeSpec).")
    problems: list[str] = []
    theme_id = theme.get("id")
    if not isinstance(theme_id, str) or not THEME_ID.match(theme_id):
        problems.append("id must be 2–40 lowercase letters, digits, or dashes, starting with a letter or digit (e.g. \"acme-report\")")
    elif theme_id in presets:
        problems.append(f"id {theme_id!r} is a Flint preset; give the theme its own id")
    if not isinstance(theme.get("label"), str) or not theme["label"].strip() or len(theme["label"]) > 60:
        problems.append("label must be a short name of at most 60 characters")
    if "description" in theme and (not isinstance(theme["description"], str) or len(theme["description"]) > 300):
        problems.append("description must be text of at most 300 characters")
    extends = theme.get("extends")
    if extends is not None and extends not in presets:
        problems.append(f"extends {extends!r} is not a Flint preset; presets: {', '.join(presets)}")
    for key, value in theme.items():
        if key not in THEME_KEYS:
            problems.append(f"unknown key {key!r}; a theme has {', '.join(THEME_KEYS)}")
        elif key in LIST_KEYS and not isinstance(value, list):
            problems.append(f"{key} must be a list")
        elif key not in LIST_KEYS and key not in ("id", "label", "description", "extends") and not isinstance(value, dict):
            problems.append(f"{key} must be an object")
    _color_problems({key: value for key, value in theme.items() if key not in ("id", "label", "description")}, "theme", problems)
    if len(json.dumps(theme)) > MAX_THEME_CHARS:
        problems.append(f"the theme is over {MAX_THEME_CHARS:,} characters; override only what differs from the preset")
    if problems:
        raise ValueError("Theme not saved: " + "; ".join(problems) + ".")
    return theme


class ThemeStore:
    """The user's saved themes."""

    def __init__(self, user_home: Any):
        self._dir = ConfinedDir(user_home)

    def list(self) -> list[dict[str, Any]]:
        if not self._dir.exists(THEME_DIR):
            return []
        themes = []
        for path in sorted(self._dir.iterdir(THEME_DIR)):
            if path.suffix != ".json":
                continue
            try:
                theme = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(theme, dict) and isinstance(theme.get("id"), str):
                themes.append(theme)
        return themes

    def get(self, theme_id: str) -> dict[str, Any] | None:
        return next((theme for theme in self.list() if theme["id"] == theme_id), None)

    def save(self, theme: Any, presets: list[str]) -> tuple[dict[str, Any], bool]:
        """Save (or replace, by id) a theme; returns it and whether it is new."""
        theme = validate_theme(theme, presets)
        existing = self.list()
        new = not any(item["id"] == theme["id"] for item in existing)
        if new and len(existing) >= MAX_THEMES:
            raise ValueError(f"Theme not saved: the library holds at most {MAX_THEMES} themes; remove one first.")
        self._dir.write_text(f"{THEME_DIR}/{theme['id']}.json", json.dumps(theme, indent=2, ensure_ascii=False) + "\n")
        return theme, new

    def delete(self, theme_id: str) -> bool:
        if not isinstance(theme_id, str) or not THEME_ID.match(theme_id) or not self._dir.exists(f"{THEME_DIR}/{theme_id}.json"):
            return False
        self._dir.unlink(f"{THEME_DIR}/{theme_id}.json")
        return True
