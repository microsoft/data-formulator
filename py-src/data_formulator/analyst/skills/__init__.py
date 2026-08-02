# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Skill registry — discovery and eager instantiation of analyst skills.

Each skill lives in its own sub-package under this directory and ships a
``SKILL.md`` with YAML frontmatter (``name`` / ``description`` /
``when_to_use`` / ``always_on`` / ``actions``). At startup the registry scans
those frontmatter blocks to build a cheap, always-resident index (tier-1
progressive disclosure) **and** imports each skill's Python code module so the
skill instance is always available to the agent.

The distinction is deliberate: a skill's code is always imported and callable;
what ``load_skill(name)`` does is flip a *switch* that exposes the skill's
tools, opens its action gate, and injects its ``SKILL.md`` body into context —
i.e. it controls exposure to the model, not availability of the code.

Convention for a skill code module: ``skills/<name>/skill.py`` exposing a
``get_skill() -> Skill`` factory. A skill that ships only a ``SKILL.md`` (pure
guidance, no code) is still discoverable — it simply has no tools or handlers.
"""

from __future__ import annotations

import importlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from data_formulator.analyst.skills.base import (
    Event,
    Skill,
    SkillContext,
    SkillMeta,
    ToolResult,
)

logger = logging.getLogger(__name__)

SKILLS_DIR = Path(__file__).parent
SKILL_DOC_NAME = "SKILL.md"
TOOLS_FILE_NAME = "tools.json"

_FM_PATTERN = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.DOTALL)


def _parse_front_matter(content: str) -> tuple[dict[str, Any], str]:
    """Return ``(frontmatter_dict, body)``. Degrades gracefully to ``({}, content)``."""
    m = _FM_PATTERN.match(content)
    if not m:
        return {}, content
    try:
        import yaml  # local import — only needed when parsing

        meta = yaml.safe_load(m.group(1))
        if not isinstance(meta, dict):
            return {}, content
    except Exception:
        return {}, content
    return meta, content[m.end():]


def _coerce_name_list(raw: Any) -> tuple[str, ...]:
    """Normalize a frontmatter name list (``tools``/``actions``) to a tuple."""
    if isinstance(raw, str):
        return (raw.strip(),) if raw.strip() else ()
    if isinstance(raw, (list, tuple)):
        return tuple(str(a).strip() for a in raw if str(a).strip())
    return ()


def _meta_from_frontmatter(raw: dict[str, Any], fallback_name: str) -> SkillMeta:
    return SkillMeta(
        name=str(raw.get("name") or fallback_name),
        description=str(raw.get("description") or ""),
        when_to_use=str(raw.get("when_to_use") or ""),
        always_on=bool(raw.get("always_on", False)),
        tool_names=_coerce_name_list(raw.get("tools")),
        action_names=_coerce_name_list(raw.get("actions")),
    )


@dataclass
class SkillRegistry:
    """Index of discovered skills, keyed by skill name.

    Holds three declarative things per skill, all resolved at build time:
    the cheap frontmatter (``SkillMeta``), the eagerly-instantiated code module
    (the *processor*: ``handle_tool`` / ``handle_action``), and the skill's
    ``tools.json`` schemas (``tool_specs``). The doc *body* is read lazily.
    """

    metas: dict[str, SkillMeta] = field(default_factory=dict)
    # Eagerly-instantiated skill code modules, keyed by name. A name present in
    # ``metas`` but absent here is a guidance-only skill (SKILL.md, no code).
    skills: dict[str, Skill] = field(default_factory=dict)
    # Declarative tool/action schemas per skill, keyed by name. Each value is a
    # flat list of standard OpenAI function-tool specs (``{"type":"function",
    # "function":{name,description,parameters}}``) covering BOTH the skill's
    # inspection tools and its committing actions; the split is decided by the
    # frontmatter ``tools:`` / ``actions:`` lists (a spec whose name is in
    # ``actions`` is a committing action, in ``tools`` an inspection tool).
    tool_specs: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    _doc_paths: dict[str, Path] = field(default_factory=dict)

    def _specs_split(self, name: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Partition a skill's ``tool_specs`` into ``(inspection_tools, actions)``
        using its frontmatter ``tools:`` / ``actions:`` lists as the authority.

        A spec whose function name is declared in ``actions:`` is a committing
        action; everything else is an inspection tool. The ``tools:`` list is the
        symmetric companion declaration: any spec not named in *either* list is
        flagged as drift (it lives in ``tools.json`` but is undeclared in
        ``SKILL.md``) and treated as an inspection tool.
        """
        meta = self.metas.get(name)
        action_set = set(meta.action_names) if meta else set()
        tool_set = set(meta.tool_names) if meta else set()
        tools: list[dict[str, Any]] = []
        actions: list[dict[str, Any]] = []
        for spec in self.tool_specs.get(name, ()):  # may be empty
            fn = spec.get("function", {}).get("name")
            if fn in action_set:
                actions.append(spec)
            else:
                if fn not in tool_set:
                    logger.warning(
                        "[skills] %s: tools.json declares %r but SKILL.md "
                        "frontmatter lists it in neither tools: nor actions: "
                        "— treating as an inspection tool.",
                        name, fn,
                    )
                tools.append(spec)
        return tools, actions

    def names(self) -> list[str]:
        return sorted(self.metas)

    def list_metas(self) -> list[SkillMeta]:
        return [self.metas[n] for n in self.names()]

    def has(self, name: str) -> bool:
        return name in self.metas

    def gated_skill_names(self) -> list[str]:
        """Skills that load on demand (not ``always_on``)."""
        return [n for n in self.names() if not self.metas[n].always_on]

    def action_owner(self, action: str) -> str | None:
        """Return the skill name that unlocks ``action``, or ``None`` if no
        gated skill declares it (i.e. it is a core action)."""
        for name in self.names():
            if action in self.metas[name].action_names:
                return name
        return None

    def render_registry_block(self) -> str:
        """Tier-1 progressive-disclosure listing for the base prompt.

        One line per gated skill: name, the actions it unlocks, and a short
        ``when_to_use``/``description``. Bodies are pulled on demand via
        ``load_skill``; only this cheap index stays resident.
        """
        lines: list[str] = []
        for name in self.gated_skill_names():
            meta = self.metas[name]
            blurb = (meta.when_to_use or meta.description or "").strip().replace("\n", " ")
            unlocks = ", ".join(meta.action_names) if meta.action_names else "(no actions)"
            lines.append(f"- **{name}** — unlocks `{unlocks}`. {blurb}")
        return "\n".join(lines)

    def load_body(self, name: str) -> str:
        """Return the ``SKILL.md`` body (frontmatter stripped) for ``name``."""
        path = self._doc_paths.get(name)
        if not path or not path.exists():
            raise KeyError(f"Unknown skill: {name!r}")
        _, body = _parse_front_matter(path.read_text(encoding="utf-8"))
        return body.strip()

    def get_skill(self, name: str) -> Skill | None:
        """Return the (eagerly-instantiated) skill code module, or ``None`` for
        an unknown or guidance-only skill."""
        return self.skills.get(name)

    def tools_for(self, names) -> list[dict[str, Any]]:
        """Merge the inspection tool specs contributed by the named (loaded) skills."""
        out: list[dict[str, Any]] = []
        for name in names:
            out.extend(self._specs_split(name)[0])
        return out

    # ------------------------------------------------------------------
    # Actions (design-docs/36): the committing tool calls a turn may end with.
    # A skill's ``tools.json`` lists tools and actions together as standard
    # function specs; the frontmatter ``actions:`` list says which are committing
    # actions. The agent offers their tool specs and dispatches the chosen one.
    # (Inspection tools gather; a committing action ends the turn.)
    # ------------------------------------------------------------------

    def action_tools_for(self, names) -> list[dict[str, Any]]:
        """Render the committing-action tool specs unlocked by the named (loaded)
        skills.

        These are offered alongside the inspection tools each round; the agent
        partitions the model's response by which tool names are committing
        actions vs inspection tools.
        """
        out: list[dict[str, Any]] = []
        for name in names:
            out.extend(self._specs_split(name)[1])
        return out

    def action_required_fields(self, name: str) -> tuple[str, ...]:
        """Return the required argument names for the action ``name`` (empty if
        unknown), read from the action schema's ``parameters.required``. Used for
        a cheap pre-dispatch completeness check."""
        for skill_name in self.names():
            for spec in self._specs_split(skill_name)[1]:
                if spec.get("function", {}).get("name") == name:
                    params = spec.get("function", {}).get("parameters") or {}
                    return tuple(params.get("required") or ())
        return ()

    def action_names(self) -> set[str]:
        """All committing-action names declared by any skill's frontmatter
        ``actions:`` — the universe of committing tool names, used to partition a
        response's tool calls into inspection tools vs committing actions."""
        out: set[str] = set()
        for meta in self.metas.values():
            out.update(meta.action_names)
        return out

    def action_stream_spec(self, action: str) -> tuple[str, str] | None:
        """Return ``(stream_field, stream_channel)`` for a *streaming* action, or
        ``None`` for a buffered one.

        Streaming is a property of the **loop**, not the schema (design-docs/36
        §5): a skill declares which of its actions stream by exposing a
        ``streaming_actions = {action: (field, channel)}`` mapping on its code
        module (behaviour lives in code, not the JSON sent to the model). The
        agent reads this to know whether to forward the action's argument live
        on its declared channel as the model writes it. Today only the report
        skill's ``write_report`` streams (its ``report`` field on the ``report``
        channel)."""
        for name in self.names():
            skill = self.skills.get(name)
            spec = getattr(skill, "streaming_actions", None)
            if spec and action in spec:
                field, channel = spec[action]
                return (str(field), str(channel))
        return None


def _instantiate_skill(name: str) -> Skill | None:
    """Import ``skills/<name>/skill.py`` and call ``get_skill()``.

    Returns ``None`` (not an error) for a guidance-only skill with no code
    module, and logs a warning for a malformed one.
    """
    module_path = f"{__name__}.{name}.skill"
    try:
        module = importlib.import_module(module_path)
    except ModuleNotFoundError:
        return None  # guidance-only skill (SKILL.md, no skill.py)
    factory = getattr(module, "get_skill", None)
    if not callable(factory):
        logger.warning("Skill module %s is missing a get_skill() factory.", module_path)
        return None
    try:
        return factory()
    except Exception:
        logger.warning("Failed to instantiate skill %r", name, exc_info=True)
        return None


def _load_tool_specs(skill_dir: Path) -> list[dict[str, Any]]:
    """Load a skill's declarative tool/action schemas from ``tools.json``.

    ``tools.json`` sits next to ``SKILL.md`` and is a flat JSON list of standard
    OpenAI function-tool specs covering BOTH the skill's inspection tools and its
    committing actions; which is which is decided by the frontmatter ``tools:`` /
    ``actions:`` lists. A skill with no ``tools.json`` (e.g. guidance-only) gets
    an empty list.
    """
    f = skill_dir / TOOLS_FILE_NAME
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Failed to parse %s", f, exc_info=True)
        return []
    return [s for s in data if isinstance(s, dict)] if isinstance(data, list) else []


def build_registry(skills_dir: Path | None = None) -> SkillRegistry:
    """Scan ``skills_dir`` for ``<name>/SKILL.md``, build the index, eagerly
    instantiate each skill's code module, and load its ``tools.json`` schemas."""
    root = skills_dir or SKILLS_DIR
    registry = SkillRegistry()
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith((".", "_")):
            continue
        doc = child / SKILL_DOC_NAME
        if not doc.exists():
            continue
        try:
            raw, _ = _parse_front_matter(doc.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to read SKILL.md for %s", child.name, exc_info=True)
            continue
        meta = _meta_from_frontmatter(raw, child.name)
        registry.metas[meta.name] = meta
        registry._doc_paths[meta.name] = doc
        instance = _instantiate_skill(meta.name)
        if instance is not None:
            registry.skills[meta.name] = instance
        registry.tool_specs[meta.name] = _load_tool_specs(child)
    _warn_on_name_collisions(registry)
    return registry


def _warn_on_name_collisions(registry: SkillRegistry) -> None:
    """Warn (don't raise) when skills declare clashing action or tool names.

    Two flat namespaces share one function-calling surface: a committing action
    resolves to a single owner (first declarer wins) and inspection tools are
    merged into one name-unique list — and since a committing action is *also* a
    tool call, its name must not clash with an inspection tool name either. A
    clash means one skill silently shadows another. Today the built-in skills
    don't collide, so this is a guard for when users drop in new skills — it
    surfaces the problem loudly at startup instead of letting it fail
    mysteriously mid-run.
    """
    action_sources: dict[str, list[str]] = {}
    tool_sources: dict[str, list[str]] = {}
    for name in registry.names():
        tools, actions = registry._specs_split(name)
        for action in registry.metas[name].action_names:
            action_sources.setdefault(action, []).append(name)
        # Inspection tools and committing actions share one tool namespace.
        for spec in (*tools, *actions):
            tool_name = spec.get("function", {}).get("name")
            if tool_name:
                tool_sources.setdefault(tool_name, []).append(name)

    for action, owners in action_sources.items():
        if len(owners) > 1:
            logger.warning(
                "Action name collision: %r is declared by multiple skills (%s). "
                "Only %r will own it; the rest are shadowed. Rename the action in "
                "the conflicting SKILL.md frontmatter.",
                action, ", ".join(owners), owners[0],
            )
    for tool_name, owners in tool_sources.items():
        if len(owners) > 1:
            logger.warning(
                "Tool name collision: %r is provided by multiple skills (%s). "
                "Function-calling tool names (inspection tools and committing "
                "actions share one namespace) must be globally unique, so one "
                "will shadow the others. Give each a distinct (e.g. "
                "skill-prefixed) name.",
                tool_name, ", ".join(owners),
            )



__all__ = [
    # Re-exported skill substrate (defined in skills/base.py)
    "Event",
    "Skill",
    "SkillContext",
    "SkillMeta",
    "ToolResult",
    # Registry
    "SkillRegistry",
    "build_registry",
    "SKILLS_DIR",
]
