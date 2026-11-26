"""References in reports and agent messages (design-docs/74).

A report refers to anything in the session by its one name, in plain Markdown:
``![caption](name)`` draws it, ``[text](name)`` links to it, and an excerpt's ``source="name"`` cites it. Names
are files (``files/…``, ``scratch/…``, ``data/…``) or session objects (``session://charts/<id>``…); the older
embeds ``chart://<id>`` and ``map://files/<name>`` and ``session/…`` forms count as their current names.

When a report is written or edited, every reference is resolved, and the agent gets one list of those that don't
resolve, each with the closest real names, so it can patch them all at once.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from typing import Any, Iterable

from data_formulator.analyst import names

_MARKDOWN_REF = re.compile(r"(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
_EXCERPT_SOURCE = re.compile(
    r"""^:{3,}\s*(?:excerpt|quote)\s*\{[^}\n]*?\bsource\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))""", re.M)
_LEGACY_SCHEMES = ("chart://", "map://", "session/", "sources/", "workflows/")
# A report the user edited is saved as HTML: its chart images, other embeds and links carry their names here.
_HTML_REF = re.compile(r'<(img|a)\b[^>]*?\b(data-chart-id|data-item-src|href)\s*=\s*"([^"]+)"', re.I)


@dataclass(frozen=True)
class Reference:
    written: str      # the target as written
    name: str         # its current name
    form: str         # embed | link | source
    caption: str


def reference_name(target: str) -> str | None:
    """The current name a Markdown target refers to, or None when it is not a session name (a web link, an
    anchor, a relative path)."""
    target = target.strip()
    if not target or target.startswith(("#", "mailto:")) or re.match(r"https?://", target, re.I):
        return None
    if not (names.is_object(target) or target.startswith(_LEGACY_SCHEMES) or target.startswith(names.FILE_ROOTS)):
        return None
    return names.canonical(target)


def find(text: str) -> list[Reference]:
    """Every reference in ``text``, in order."""
    found: list[Reference] = []
    for match in _MARKDOWN_REF.finditer(text or ""):
        name = reference_name(match.group(3))
        if name:
            found.append(Reference(match.group(3), name, "embed" if match.group(1) else "link", match.group(2)))
    for match in _HTML_REF.finditer(text or ""):
        tag, attribute, value = match.group(1).lower(), match.group(2).lower(), match.group(3)
        name = names.chart(value) if attribute == "data-chart-id" else reference_name(value)
        if name:
            found.append(Reference(value, name, "embed" if tag == "img" else "link", ""))
    for match in _EXCERPT_SOURCE.finditer(text or ""):
        written = next(group for group in match.groups() if group is not None)
        name = reference_name(written)
        if name:
            found.append(Reference(written, name, "source", ""))
    return found


def refers_to(text: str, name: str) -> bool:
    """Whether ``text`` embeds or links to ``name`` (in any of its forms)."""
    wanted = names.canonical(name)
    return any(reference.name == wanted for reference in find(text))


def known_names(layer: Any, workspace: Any, run_charts: Iterable[str] = ()) -> dict[str, str]:
    """Every name a reference may use in this session, with the name the user sees (or "")."""
    known: dict[str, str] = {}
    if layer is not None:
        for path in layer.paths():
            try:
                known[path] = layer.name_of(path) or ""
            except Exception:
                known[path] = ""
        for table in layer.tables:
            data_file = layer.data_file(layer.table_name(table))
            if data_file:
                known[data_file] = str(table.get("displayId") or "")
    for chart_id in run_charts:
        known.setdefault(names.chart(chart_id), "")
    if workspace is not None:
        try:
            for item in workspace.list_workspace_files():
                known[f"files/{item.name}"] = item.display_name or ""
        except Exception:
            pass
        try:
            for path in workspace.list_scratch_files():
                known.setdefault(path, "")
        except Exception:
            pass
    return known


def unresolved(references: Iterable[Reference], known: dict[str, str]) -> list[tuple[Reference, list[str]]]:
    """The references whose names are not in ``known``, once each, with up to two close real names."""
    missing: list[tuple[Reference, list[str]]] = []
    seen: set[str] = set()
    for reference in references:
        if reference.name in known or reference.name in seen:
            continue
        seen.add(reference.name)
        root, folder = names.root_of(reference.name), names.folder_of(reference.name)
        candidates = [name for name in known if names.root_of(name) == root and names.folder_of(name) == folder]
        missing.append((reference, difflib.get_close_matches(reference.name, candidates, n=2, cutoff=0.5)))
    return missing


def describe(missing: list[tuple[Reference, list[str]]], known: dict[str, str]) -> str:
    """One sentence per unresolved reference, for the agent."""
    def option(name: str) -> str:
        return f"`{name}`" + (f' ("{known[name]}")' if known.get(name) else "")

    parts = []
    for reference, close in missing:
        hint = f" (did you mean {' or '.join(option(name) for name in close)}?)" if close else ""
        parts.append(f"`{reference.written}`{hint}")
    count = len(missing)
    return f"{count} {'reference does' if count == 1 else 'references do'} not resolve: " + "; ".join(parts) + "."
