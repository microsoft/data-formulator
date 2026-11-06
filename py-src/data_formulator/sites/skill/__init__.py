# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The ``demo`` analyst skill (design-docs/69).

It is not in ``analyst/skills/``, so the standard registry never discovers it:
``SkillRegistry.with_demo`` adds it to the copy of the registry built for one demo request,
with a body made for that demo (``demo_skill_body``): this folder's generic guidance, the
demo's own ``skill/SKILL.md``, and its datasets and example questions.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from data_formulator.sites import PACKAGED_DEMOS, site_profile, sites_dir

DEMO_SKILL = "demo"
SKILL_DIR = Path(__file__).resolve().parent

# Baseline tools a demo does not offer: they work on connected sources, and a demo has none.
DEMO_WITHOUT_TOOLS = frozenset({"probe_data", "propose_data_operation"})

# The baseline guidance (always in the prompt) as it reads on a demo: what it says about connected sources,
# setting up the app, apps and the internet is replaced or dropped. Each rule names a line (or, ending in "…",
# the paragraph it starts) by its opening words, or ("=…") exact text; ``demo_body_edits`` fails if one no longer
# matches its skill's text.
_DEMO_RULES: dict[str, tuple[tuple[str, str], ...]] = {
    "meta": (
        ("a skill; data beyond the session needs `connected_data` first",
         "a skill; on this demo, data beyond the session is the demo's datasets, loaded with `load_datasets`."),
        ("| Analyze a new subject or load data |",
         "| Analyze a new subject or load data | Load the demo datasets the question needs with `load_datasets` "
         "(the demo skill). | Continue the analysis after loading. |"),
        ("| Find out what data exists |",
         "| Find out what data exists | Answer from the demo skill's dataset list and the session's tables. "
         "| The availability question is answered; no unsolicited load is needed. |"),
        ("| Set up or manage Data Formulator", ""),
        ("| Create or revise a file |",
         "| Create or revise a file | Use `create_file` or `edit_file`. | The requested artifact exists as a "
         "durable workspace file, not merely a description of how to create it. |"),
        ("| Build or change an interactive app or dashboard |", ""),
    ),
    "analysis": (
        ("=Network access depends on the deployment\n(local macOS allows internet but never local services); when it is unavailable,\n"
         "acquire remote data with the data-loading tools instead.",
         "Do not fetch data from the internet on this demo:\nuse only the demo's datasets."),
    ),
    "workspace": (
        ("Before finding, probing, or loading data that is not already a table…",
         "On this demo the only data beyond the session is the demo's own datasets: load them with\n"
         "`load_datasets` (the demo skill). There are no connected sources, uploads, files from the web or\n"
         "local folders."),
        ("not listed there has not been loaded — find it in a connected source and load it",
         "not listed there has not been loaded — load its dataset with `load_datasets`"),
        ("A connected-source reference (`session/references/<id>.json`)…", ""),
        ("| Data in a connected source |", ""),
        ("| External reference schema or evidence |", ""),
        ("sources/    connected-source catalogs", ""),
    ),
}


def _rule_edit(text: str, start: str, new: str) -> tuple[str, str]:
    """The (old, new) pair for one rule: the line, or the paragraph, ``start`` opens."""
    if start.startswith("="):
        if start[1:] not in text:
            raise ValueError(f"demo guidance rule no longer matches: {start[1:40]!r}")
        return start[1:], new
    paragraph = start.endswith("…")
    opening = start.rstrip("…")
    at = text.find(opening)
    if at < 0 or (at > 0 and text[at - 1] != "\n"):
        raise ValueError(f"demo guidance rule no longer matches: {opening!r}")
    end = text.find("\n\n" if paragraph else "\n", at)
    end = len(text) if end < 0 else end
    old = text[at:end]
    # A dropped line takes its line break with it.
    return (old + "\n", "") if not new and not paragraph else (old, new)


# The baseline tools' descriptions as they read on a demo, as (old, new) phrases, and parameters a demo drops;
# ``demo_tool_specs`` fails if a phrase no longer matches.
_DEMO_TOOL_EDITS: dict[str, tuple[tuple[str, str], ...]] = {
    "search": (
        (", then connected-source catalogs (sources/: table names, descriptions and columns, not rows), so one search "
         "tells whether data is already here or must be loaded.",
         ", so one search tells whether data is already here or must be loaded with load_datasets."),
        ("Searches everything except workflows/ by default, catalog matches last; pass path (e.g. session/tables/, "
         "files/docs/, sources/ or sources/<source_id>/) when you know where to look. Connected sources match on cached "
         "metadata only; probe_data queries their values.",
         "Searches everything except workflows/ by default; pass path (e.g. session/tables/, files/docs/) when you know "
         "where to look."),
    ),
    "list_files": (
        (", references/<id>.json for connected-source tables", ""),
        (" sources/ holds connected-source catalogs (sources/<source_id>/<path>), listed one level at a time; workflows/",
         " workflows/"),
    ),
    "read_file": (
        ("scratch/..., sources/..., workflows/...", "scratch/..., workflows/..."),
        (" A connected-source table (sources/...): its source_id, table_key, description and columns one per line "
         "(offset/limit page wide tables).", ""),
    ),
    "visualize": (
        ("(load more by following the connected_data skill)", "(load more of the demo's datasets with load_datasets)"),
    ),
    "visualize.code": (
        (" Read declared connector inputs using pd.read_parquet(connector_inputs['alias']); do not guess filenames or "
         "access connectors from Python.", " Do not guess filenames."),
    ),
    "update_data": (("User uploads and connector tables are protected", "Loaded tables are protected"),),
    "delete_items": (("connected-source references, ", ""),),
}
_DEMO_DROPPED_PARAMETERS = {"visualize": ("connector_inputs",)}


def demo_tool_specs(specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """A skill's tool specs as a demo offers them (edited copies)."""
    from copy import deepcopy

    out = []
    for spec in specs:
        spec = deepcopy(spec)
        function = spec.get("function", {})
        name = function.get("name")
        targets = [(function, "description", _DEMO_TOOL_EDITS.get(name, ()))]
        for key, edits in _DEMO_TOOL_EDITS.items():
            tool, _, parameter = key.partition(".")
            if tool == name and parameter:
                targets.append((function["parameters"]["properties"][parameter], "description", edits))
        for holder, field, edits in targets:
            for old, new in edits:
                if old not in holder.get(field, ""):
                    raise ValueError(f"demo tool edit for {name!r} no longer matches: {old[:40]!r}")
                holder[field] = holder[field].replace(old, new)
        for parameter in _DEMO_DROPPED_PARAMETERS.get(name, ()):
            parameters = function.get("parameters", {})
            parameters.get("properties", {}).pop(parameter, None)
            if parameter in parameters.get("required", []):
                parameters["required"] = [item for item in parameters["required"] if item != parameter]
        out.append(spec)
    return out


@lru_cache(maxsize=1)
def demo_body_edits() -> dict[str, tuple[tuple[str, str], ...]]:
    from data_formulator.analyst.skills import SKILLS_DIR

    edits = {}
    for name, rules in _DEMO_RULES.items():
        text = (SKILLS_DIR / name / "SKILL.md").read_text(encoding="utf-8")
        edits[name] = tuple(_rule_edit(text, start, new) for start, new in rules)
    return edits


def _body(path: Path) -> str:
    from data_formulator.analyst.skills import _parse_front_matter

    return _parse_front_matter(path.read_text(encoding="utf-8"))[1].strip()


def demo_guidance(site_id: str) -> str:
    """The demo's own ``skill/SKILL.md`` body: installed with its content, else shipped with Data Formulator."""
    for base in (sites_dir(), PACKAGED_DEMOS):
        path = base / site_id / "skill" / "SKILL.md"
        if path.is_file():
            return _body(path)
    return ""


def demo_examples(site_id: str) -> list[dict[str, Any]]:
    """Every example analysis of the demo (its question, for the analyst to run), with the dataset it belongs to."""
    return [{**story, "dataset": starter.get("id")}
            for starter in (site_profile(site_id) or {}).get("starters") or []
            for story in starter.get("stories") or []]


def demo_skill_body(site_id: str) -> str:
    from data_formulator.sites.datasets import demo_datasets, shared_tables

    profile = site_profile(site_id) or {}
    datasets = demo_datasets(site_id)
    shared = shared_tables(datasets)
    parts = [_body(SKILL_DIR / "SKILL.md").replace("{demo_name}", str(profile.get("name") or site_id))]
    if guidance := demo_guidance(site_id):
        parts.append(guidance)
    elif tagline := str(profile.get("tagline") or "").strip():
        parts.append(f"## What this demo shows\n\n{tagline}")

    lines = ["## Datasets", ""]
    if shared:
        lines += [f"Tables several datasets carry (loaded once): {', '.join(sorted(shared))}.", ""]
    for dataset in datasets:
        tables = ", ".join(f"{table.name} ({table.rows:,} rows)" for table in dataset.tables if table.name not in shared)
        lines.append(f"- `{dataset.id}`: {dataset.title}. {dataset.description} Tables: {tables}.".replace("  ", " "))
    parts.append("\n".join(lines))

    examples = demo_examples(site_id)
    if examples:
        lines = ["## Example questions", ""]
        for story in examples:
            headline = str(story.get("headline") or "").strip()
            lines.append(f"- ({story['dataset']}) {json.dumps(str(story.get('prompt') or '').strip(), ensure_ascii=False)}"
                         f"{f' Earlier finding: {headline}.' if headline else ''}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


def demo_skill_available(site_id: str | None) -> bool:
    """A demo with at least one installed dataset gets the skill."""
    if not site_id or not site_profile(site_id):
        return False
    from data_formulator.sites.datasets import demo_datasets
    return bool(demo_datasets(site_id))
