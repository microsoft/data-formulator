"""Replacing an artifact the user wants fixed.

When the user says an artifact is wrong or unwanted and asks for it to be
fixed, the agent can produce the fixed one with ``replaces: <id>``: the old
artifact is deleted and the new one takes its place after the latest request.
Exploration never replaces; it adds artifacts so the analysis keeps its history.

Only agent-created artifacts with nothing built on them can be replaced. The
application lists them in the request (``replaceable_artifacts``: id, kind,
name, aliases, and a ``blocked`` reason for ones that cannot be replaced); this
run's own artifacts are added as they are created, and stop being replaceable
once a later step reads them.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

ARTIFACT_KINDS = ("table", "file", "report")
_KIND_NOUNS = {"table": "table or chart", "file": "app or file", "report": "report"}


def _canonical(target: str, kind: str) -> str:
    target = target.strip()
    if kind == "file" and not target.startswith("files/"):
        return f"files/{target}"
    return target


def _entries(ctx: Any) -> list[dict[str, Any]]:
    from data_formulator.analyst.session_layer import session_layer

    payload = ctx.payload or {}
    layer = session_layer(payload)
    # The session layer knows the session; a run without one uses the list the application sent.
    listed = layer.replaceable(layer.focus_node(), limit=10_000) if layer is not None else \
        [item for item in payload.get("replaceable_artifacts") or [] if isinstance(item, dict)]
    run = list((payload.get("run_artifacts") or {}).values())
    # This run's artifacts come last so a fresh record wins over the request's list.
    return [*listed, *run]


def _matches(entry: dict[str, Any], target: str) -> bool:
    names = {str(entry.get("id") or ""), *(str(alias) for alias in entry.get("aliases") or [])}
    return target in names or (target.startswith("files/") and target[len("files/"):] in names)


def resolve_replacement(target: Any, kind: str, ctx: Any) -> dict[str, Any]:
    """The artifact ``replaces`` names, checked; raises ``ValueError`` with a message for the agent."""
    if not isinstance(target, str) or not target.strip():
        raise ValueError("replaces must be the id of the artifact to replace")
    target = _canonical(target, kind)
    entry = next((item for item in reversed(_entries(ctx)) if _matches(item, target)), None)
    fallback = "Omit replaces to create a new artifact instead."
    if entry is None:
        raise ValueError(f"Cannot replace {target!r}: it is not an agent-created artifact listed in "
                         f"[REPLACEABLE ARTIFACTS] or made earlier in this run. {fallback}")
    if entry.get("kind") != kind:
        raise ValueError(f"Cannot replace {target!r} here: it is a {_KIND_NOUNS.get(entry.get('kind'), 'different artifact')}, "
                         f"and this action makes a {_KIND_NOUNS[kind]}. {fallback}")
    if entry.get("blocked"):
        raise ValueError(f"Cannot replace {target!r}: {entry['blocked']}. {fallback}")
    if kind == "table":
        reader = _app_reading_table(entry, ctx)
        if reader:
            raise ValueError(f"Cannot replace {target!r}: the app {reader} reads it. {fallback}")
    # `id` is what the agent sees (a table name, a files/ path, a report id); `node_id` is the application's
    # thread node for it, when the request named one.
    return {"id": str(entry.get("id")), "kind": kind, "name": str(entry.get("name") or target),
            **({"node_id": str(entry["node_id"])} if entry.get("node_id") else {})}


def record_run_artifact(ctx: Any, kind: str, artifact_id: str, name: str, aliases: list[str] | None = None,
                        node_id: str | None = None) -> None:
    """Remember an artifact this run made, so a later step can replace it."""
    artifacts = (ctx.payload or {}).get("run_artifacts")
    if not isinstance(artifacts, dict) or not artifact_id:
        return
    artifacts[artifact_id] = {"id": artifact_id, "kind": kind, "name": name, "aliases": [a for a in aliases or [] if a],
                              **({"node_id": node_id} if node_id else {})}


def forget_run_artifact(ctx: Any, artifact_id: str) -> None:
    artifacts = (ctx.payload or {}).get("run_artifacts")
    if isinstance(artifacts, dict):
        artifacts.pop(artifact_id, None)


def mark_run_artifacts_used(ctx: Any, names: list[str]) -> None:
    """This run's artifacts that a later step read can no longer be replaced."""
    artifacts = (ctx.payload or {}).get("run_artifacts")
    if not isinstance(artifacts, dict):
        return
    used = {name for name in names if name}
    for entry in artifacts.values():
        if used & {entry["id"], *entry.get("aliases", [])}:
            entry["blocked"] = "a later step of this run already uses it"


def _app_reading_table(entry: dict[str, Any], ctx: Any) -> str | None:
    """The first agent app that declares this table, if any (apps read tables live)."""
    workspace = getattr(ctx, "workspace", None)
    if workspace is None:
        return None
    names = {str(entry.get("id") or ""), *(str(alias) for alias in entry.get("aliases") or [])}
    try:
        from data_formulator.analyst.skills.html_app.skill import APP_FILE_SUFFIXES, read_app_manifest
        for item in workspace.list_workspace_files():
            lower = item.name.lower()
            if not lower.endswith(APP_FILE_SUFFIXES):
                continue
            _, content = workspace.read_workspace_file(item.name)
            text = content.decode("utf-8", errors="replace")
            manifest = read_app_manifest(item.name, text)
            if manifest and names & {str(table) for table in manifest.get("tables") or []}:
                return f"files/{item.name}"
    except Exception:
        logger.warning("Could not check which apps read a table", exc_info=True)
    return None


