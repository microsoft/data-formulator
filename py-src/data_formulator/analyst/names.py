"""One name per thing (design-docs/74): how the agent names what is in a session.

Files are workspace paths (``files/``, ``scratch/``, ``data/``), the same in every tool and in code. Everything
else is an object named with a scheme, reached through tools only:

- ``session://index``, ``session://tables/<name>``, ``session://charts/<id>``, ``session://reports/<id>``,
  ``session://threads/<n>``, ``session://references/<id>``
- ``sources://<source_id>/<path>``: connected-source catalogs
- ``workflows://<store path>``: saved workflows and ``workflows://schedules.json``

Older names stay accepted (saved trajectories, workflows and reports hold them) and are normalized here:
``session/charts/<id>.json``, ``session/reports/<id>.md``, ``sources/…``, ``workflows/…``, and the report embeds
``chart://<id>`` and ``map://files/<name>.map.json``.
"""

from __future__ import annotations

SESSION = "session://"
SOURCES = "sources://"
WORKFLOWS = "workflows://"
SCHEMES = (SESSION, SOURCES, WORKFLOWS)
INDEX = f"{SESSION}index"
FOLDERS = ("tables", "charts", "reports", "threads", "references")
FILE_ROOTS = ("files/", "scratch/", "data/")

# The suffix each session folder's items had as files (design-docs/60).
_LEGACY_SUFFIX = {"tables": ".json", "charts": ".json", "reports": ".md", "threads": ".md", "references": ".json"}
_LEGACY_ROOTS = {"session/": SESSION, "sources/": SOURCES, "workflows/": WORKFLOWS}


def canonical(name: str) -> str:
    """``name`` in its current form; files and unknown strings come back unchanged (stripped)."""
    name = name.strip()
    for legacy, scheme in _LEGACY_ROOTS.items():
        if name.startswith(legacy):
            name = scheme + name[len(legacy):]
            break
    if name.startswith("chart://"):
        return chart(name[len("chart://"):])
    if name.startswith("map://"):
        return name[len("map://"):]
    if not name.startswith(SESSION):
        return name
    rest = name[len(SESSION):]
    if rest in ("index", "index.md"):
        return INDEX
    folder, _, leaf = rest.partition("/")
    suffix = _LEGACY_SUFFIX.get(folder)
    if suffix and leaf.endswith(suffix):
        leaf = leaf[:-len(suffix)]
    return f"{SESSION}{folder}/{leaf}" if folder in FOLDERS and leaf else name


def is_object(name: str) -> bool:
    return isinstance(name, str) and name.strip().startswith(SCHEMES)


def is_session(name: str) -> bool:
    return isinstance(name, str) and canonical(name).startswith(SESSION)


def folder_of(name: str) -> str | None:
    """``tables``, ``charts``, … for a session object; ``index`` for the index; None otherwise."""
    name = canonical(name)
    if name == INDEX:
        return "index"
    if not name.startswith(SESSION):
        return None
    folder = name[len(SESSION):].split("/", 1)[0]
    return folder if folder in FOLDERS else None


def leaf_of(name: str, folder: str) -> str | None:
    """The id or table name in ``session://<folder>/<leaf>``, or None when ``name`` is not one."""
    name = canonical(name)
    prefix = f"{SESSION}{folder}/"
    return name[len(prefix):] or None if name.startswith(prefix) else None


def root_of(name: str) -> str:
    """The top-level root of a name: ``files``, ``scratch``, ``data``, ``session``, ``sources`` or ``workflows``."""
    name = canonical(name)
    for scheme in SCHEMES:
        if name.startswith(scheme):
            return scheme[:-len("://")]
    return name.lstrip("/").split("/", 1)[0]


def table(name: str) -> str:
    return f"{SESSION}tables/{name}"


def chart(chart_id: str) -> str:
    return f"{SESSION}charts/{chart_id}"


def report(report_id: str) -> str:
    return f"{SESSION}reports/{report_id}"


def thread(number: int | str) -> str:
    return f"{SESSION}threads/{number}"


def reference(reference_id: str) -> str:
    return f"{SESSION}references/{reference_id}"
