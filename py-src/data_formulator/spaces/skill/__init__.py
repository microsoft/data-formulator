# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The ``space`` analyst skill (design-docs/69).

It is not in ``analyst/skills/``, so the standard registry never discovers it:
``SkillRegistry.with_space`` adds it to the copy of the registry built for one space request,
with a body made for that space (``space_skill_body``): this folder's generic guidance, the
space's own ``skill/SKILL.md``, and its datasets and example questions.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from data_formulator.spaces import SHIPPED_SPACES, space_profile, spaces_dir

SPACE_SKILL = "space"
SKILL_DIR = Path(__file__).resolve().parent


def _body(path: Path) -> str:
    from data_formulator.analyst.skills import _parse_front_matter

    return _parse_front_matter(path.read_text(encoding="utf-8"))[1].strip()


def space_guidance(space_id: str) -> str:
    """The space's own ``skill/SKILL.md`` body: installed with its content, else shipped with Data Formulator."""
    for base in (spaces_dir(), SHIPPED_SPACES):
        path = base / space_id / "skill" / "SKILL.md"
        if path.is_file():
            return _body(path)
    return ""


def space_examples(space_id: str) -> list[dict[str, Any]]:
    """Every example analysis of the space (its question, for the analyst to run), with the dataset it belongs to."""
    return [{**story, "dataset": starter.get("id")}
            for starter in (space_profile(space_id) or {}).get("starters") or []
            for story in starter.get("stories") or []]


def space_skill_body(space_id: str) -> str:
    from data_formulator.spaces.datasets import space_datasets, shared_tables

    profile = space_profile(space_id) or {}
    datasets = space_datasets(space_id)
    shared = shared_tables(datasets)
    parts = [_body(SKILL_DIR / "SKILL.md").replace("{space_name}", str(profile.get("name") or space_id))]
    if guidance := space_guidance(space_id):
        parts.append(guidance)
    elif tagline := str(profile.get("tagline") or "").strip():
        parts.append(f"## What this space shows\n\n{tagline}")

    lines = ["## Datasets", ""]
    if shared:
        lines += [f"Tables several datasets carry (loaded once): {', '.join(sorted(shared))}.", ""]
    for dataset in datasets:
        tables = ", ".join(f"{table.name} ({table.rows:,} rows)" for table in dataset.tables if table.name not in shared)
        lines.append(f"- `{dataset.id}`: {dataset.title}. {dataset.description} Tables: {tables}.".replace("  ", " "))
    parts.append("\n".join(lines))

    examples = space_examples(space_id)
    if examples:
        lines = ["## Example questions", ""]
        for story in examples:
            headline = str(story.get("headline") or "").strip()
            lines.append(f"- ({story['dataset']}) {json.dumps(str(story.get('prompt') or '').strip(), ensure_ascii=False)}"
                         f"{f' Earlier finding: {headline}.' if headline else ''}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def space_skill_available(space_id: str | None) -> bool:
    """A space with at least one installed dataset gets the skill."""
    if not space_id or not space_profile(space_id):
        return False
    from data_formulator.spaces.datasets import space_datasets
    return bool(space_datasets(space_id))
