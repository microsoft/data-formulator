"""Deleting session items the user asked the agent to remove.

The session layer (design-docs/61) lists what the session holds: tables (loaded and
derived) with their charts, the tables computed from them and the reports that use
them; charts with the reports that embed them; and connected-source references
with the tables computed from them. The agent names
items to delete; this module works out everything that goes with them (a table's
charts, a derived table whose last chart goes) and refuses when something kept
depends on what would be deleted, so a deletion never leaves broken items behind.
The application then deletes them.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

MAX_TARGETS = 50
_LISTED = 40


def _inventory(ctx: Any) -> dict[str, list[dict[str, Any]]]:
    from data_formulator.analyst.session_layer import session_layer
    layer = session_layer(ctx.payload)
    if layer is None:
        raise ValueError("This run has no session to delete from.")
    return layer.items()


def _names(item: dict[str, Any]) -> set[str]:
    return {str(item.get("id")), str(item.get("node_id") or item.get("id")),
            *(str(alias) for alias in item.get("aliases") or [] if alias),
            *([str(item["name"])] if item.get("name") else [])}


def _resolve(target: str, inventory: dict[str, list[dict[str, Any]]]) -> tuple[str, dict[str, Any]] | None:
    # Ids win over display names, which can repeat.
    for exact in (True, False):
        for kind in ("tables", "charts", "references"):
            for item in inventory[kind]:
                names = {str(item.get("id")), str(item.get("node_id") or item.get("id"))} if exact else _names(item)
                if target in names:
                    return kind, item
    return None


def _listing(inventory: dict[str, list[dict[str, Any]]]) -> str:
    nouns = {"tables": "table", "charts": "chart", "references": "connected-source reference"}
    lines = [f"- {item['id']} ({nouns[kind]}): {item.get('name') or item['id']}"
             for kind in ("tables", "charts", "references") for item in inventory[kind]]
    if not lines:
        return "The session has no tables, charts, or references to delete."
    more = f"\n- … {len(lines) - _LISTED} more" if len(lines) > _LISTED else ""
    return "Items in this session:\n" + "\n".join(lines[:_LISTED]) + more


def _apps(ctx: Any) -> list[tuple[str, set[str], set[str]]]:
    """Each agent app with the tables and sources its manifest declares (apps read them live)."""
    workspace = getattr(ctx, "workspace", None)
    if workspace is None:
        return []
    apps = []
    try:
        from data_formulator.analyst.skills.html_app.skill import APP_FILE_SUFFIXES, read_app_manifest
        for item in workspace.list_workspace_files():
            lower = item.name.lower()
            if not lower.endswith(APP_FILE_SUFFIXES):
                continue
            _, content = workspace.read_workspace_file(item.name)
            text = content.decode("utf-8", errors="replace")
            manifest = read_app_manifest(item.name, text)
            if manifest:
                apps.append((f"files/{item.name}", {str(name) for name in manifest.get("tables") or []},
                             {str(source) for source in manifest.get("sources") or []}))
    except Exception:
        logger.warning("Could not check which apps read session items", exc_info=True)
    return apps


def _workspace_files(targets: list[str], ctx: Any) -> tuple[list[str], list[str]]:
    """The workspace files ``files/...`` targets name (a folder names all its files), and the other targets."""
    workspace = getattr(ctx, "workspace", None)
    names = [item.name for item in workspace.list_workspace_files()] if workspace is not None else []
    files: list[str] = []
    others = []
    for target in targets:
        if not target.startswith("files/"):
            others.append(target)
            continue
        name = target[len("files/"):].rstrip("/")
        found = [item for item in names if item == name or item.startswith(name + "/")]
        if not found:
            raise ValueError(f"{target} is not a workspace file or folder. Use list_files to see them.")
        files.extend(item for item in found if item not in files)
    return files, others


def _module_imported(module: str, imports: list[str]) -> bool:
    return any(name == module or name.startswith(module + ".") or module.startswith(name + ".") for name in imports)


def file_imported(name: str, table: dict[str, Any]) -> bool:
    """Whether a table's code imports the helper ``files/<name>``."""
    from data_formulator.analyst.session_files import helper_module_name
    module = helper_module_name(f"files/{name}")
    return bool(module) and _module_imported(module, table.get("imports") or [])


def plan_deletion(targets: Any, ctx: Any) -> dict[str, list[dict[str, Any]]]:
    """Everything deleting ``targets`` removes; raises ``ValueError`` with a message for the agent."""
    if not isinstance(targets, list) or not targets or not all(isinstance(t, str) and t.strip() for t in targets):
        raise ValueError("items must be a non-empty list of item ids")
    if len(targets) > MAX_TARGETS:
        raise ValueError(f"Delete at most {MAX_TARGETS} items at a time")
    deleted_files, targets = _workspace_files([t.strip() for t in targets], ctx)
    if not targets:
        return _plan_files(deleted_files, ctx)
    inventory = _inventory(ctx)
    tables = {str(item.get("node_id") or item["id"]): item for item in inventory["tables"]}
    charts = {str(item["id"]): item for item in inventory["charts"]}
    references = {str(item["id"]): item for item in inventory["references"]}

    deleted_tables: dict[str, str | None] = {}   # node id -> why it goes, when it was not named
    deleted_charts: dict[str, str | None] = {}
    deleted_references: list[str] = []
    unknown = []
    for target in dict.fromkeys(t.strip() for t in targets):
        found = _resolve(target, inventory)
        if found is None:
            unknown.append(target)
        elif found[0] == "tables":
            deleted_tables[str(found[1].get("node_id") or found[1]["id"])] = None
        elif found[0] == "charts":
            deleted_charts[str(found[1]["id"])] = None
        elif found[1]["id"] not in deleted_references:
            deleted_references.append(str(found[1]["id"]))
    if unknown:
        raise ValueError(f"Not in this session: {', '.join(map(repr, unknown))}. Only items that existed when the "
                         f"user sent this request can be deleted; to fix an item made in this run use replaces. "
                         f"{_listing(inventory)}")

    # What goes with them, as the application deletes it: a table's charts, and a derived table
    # left with nothing built on it (no chart, no table computed from it).
    changed = True
    while changed:
        changed = False
        for node_id in list(deleted_tables):
            for chart_id in tables[node_id].get("charts") or []:
                if chart_id in charts and chart_id not in deleted_charts:
                    deleted_charts[chart_id] = f"chart of {tables[node_id].get('name') or node_id}"
                    changed = True
        for node_id, table in tables.items():
            if node_id in deleted_tables or table.get("origin") != "derived":
                continue
            built = [*(table.get("charts") or []), *(table.get("computed_into") or [])]
            if built and all(item in deleted_charts or item in deleted_tables for item in built):
                deleted_tables[node_id] = "nothing is left built on it"
                changed = True

    blockers = []
    def kept(ids: list[str]) -> list[str]:
        return [tables[i].get("name") or i if i in tables else i for i in ids if i not in deleted_tables]
    table_reason = {node_id: why for node_id, why in deleted_tables.items() if why}
    for node_id in deleted_tables:
        table = tables[node_id]
        label = table.get("name") or node_id
        for name in kept(table.get("computed_into") or []):
            blockers.append(f"the table {name} was computed from {label}")
        made_from = table.get("reports_made_from") or []
        for report in made_from:
            blockers.append(f"the report {report} was made from {label} and would be deleted with it"
                            + (f"; {label} goes because nothing would be left built on it" if table_reason.get(node_id) else ""))
        for report in table.get("reports") or []:
            if report not in made_from:
                blockers.append(f"the report {report} uses {label}")
    for chart_id in deleted_charts:
        for report in charts[chart_id].get("reports") or []:
            blockers.append(f"the report {report} shows the chart {charts[chart_id].get('name') or chart_id}")
    for reference_id in deleted_references:
        reference = references[reference_id]
        for name in kept(reference.get("computed_into") or []):
            blockers.append(f"the table {name} was computed from {reference.get('name') or reference_id}")
    for path, app_tables, app_sources in _apps(ctx):
        for node_id in deleted_tables:
            if app_tables & _names(tables[node_id]):
                blockers.append(f"the app {path} reads {tables[node_id].get('name') or node_id}")
        for reference_id in deleted_references:
            if reference_id in app_sources:
                blockers.append(f"the app {path} reads {references[reference_id].get('name') or reference_id}")
    kept_tables = {node_id: table for node_id, table in tables.items() if node_id not in deleted_tables}
    blockers.extend(_file_blockers(deleted_files, kept_tables))
    if blockers:
        raise ValueError("Nothing was deleted: " + "; ".join(dict.fromkeys(blockers)) + ". Deleting it would break "
                         "what depends on it. Tables computed from an item can be deleted with it if the user wants "
                         "them gone too. A report that shows a chart or table can be edited first (edit_file) to drop "
                         "it, when the user wants that; a report made from a table goes with that table, so only the user "
                         "can remove it (or keep the item). Apps are changed by rewriting them.")

    def table_entry(node_id: str) -> dict[str, Any]:
        table = tables[node_id]
        return {"id": str(table["id"]), "node_id": node_id, "name": str(table.get("name") or table["id"]),
                **({"origin": table["origin"]} if table.get("origin") else {}),
                **({"because": deleted_tables[node_id]} if deleted_tables[node_id] else {})}

    return {
        "tables": [table_entry(node_id) for node_id in deleted_tables],
        "charts": [{"id": chart_id, "name": str(charts[chart_id].get("name") or chart_id),
                    **({"table": str(charts[chart_id]["table"])} if charts[chart_id].get("table") else {}),
                    **({"because": deleted_charts[chart_id]} if deleted_charts[chart_id] else {})}
                   for chart_id in deleted_charts],
        "references": [{"id": reference_id, "name": str(references[reference_id].get("name") or reference_id)}
                       for reference_id in deleted_references],
        "files": [{"path": f"files/{name}", "name": name} for name in deleted_files],
    }


def _file_blockers(files: list[str], kept_tables: dict[str, dict[str, Any]]) -> list[str]:
    from data_formulator.analyst.session_files import helper_module_name

    blockers = []
    for name in files:
        module = helper_module_name(f"files/{name}")
        for node_id, table in kept_tables.items():
            label = table.get("name") or node_id
            if name in (table.get("files") or []):
                blockers.append(f"the table {label} was computed from files/{name}")
            elif module and _module_imported(module, table.get("imports") or []):
                blockers.append(f"the code of the table {label} imports files/{name}")
    return blockers


def _plan_files(files: list[str], ctx: Any) -> dict[str, list[dict[str, Any]]]:
    from data_formulator.analyst.session_layer import session_layer
    layer = session_layer(ctx.payload)
    tables = {item["node_id"]: item for item in layer.items()["tables"]} if layer is not None else {}
    blockers = _file_blockers(files, tables)
    if blockers:
        raise ValueError("Nothing was deleted: " + "; ".join(dict.fromkeys(blockers)) + ". Deleting it would break "
                         "what depends on it; the user must change or remove those first.")
    return {"tables": [], "charts": [], "references": [],
            "files": [{"path": f"files/{name}", "name": name} for name in files]}


def delete_files(plan: dict[str, list[dict[str, Any]]], ctx: Any) -> None:
    """Delete the plan's workspace files (the application removes their thread items)."""
    workspace = getattr(ctx, "workspace", None)
    for entry in plan.get("files") or []:
        if workspace is not None:
            workspace.delete_workspace_file(entry["name"])


def forget_deleted(plan: dict[str, list[dict[str, Any]]], ctx: Any) -> None:
    """Drop deleted items from this run's view of the session, so later steps do not use them."""
    payload = ctx.payload or {}
    gone_tables = {entry["node_id"] for entry in plan["tables"]}
    gone_charts = {entry["id"] for entry in plan["charts"]}
    gone_references = {entry["id"] for entry in plan["references"]}
    from data_formulator.analyst.session_layer import session_layer
    layer = session_layer(payload)
    if layer is not None:
        layer.forget(tables=gone_tables, charts=gone_charts, references=gone_references)
    table_names = {entry["id"] for entry in plan["tables"]} | gone_tables
    for key, matches in (
        ("input_tables", lambda item: item.get("name") in table_names),
        ("replaceable_artifacts", lambda item: item.get("node_id") in gone_tables or item.get("id") in table_names),
        ("charts", lambda item: item.get("chart_id") in gone_charts),
    ):
        listed = payload.get(key)
        if isinstance(listed, list):
            listed[:] = [item for item in listed if not (isinstance(item, dict) and matches(item))]
    references = payload.get("external_references")
    if isinstance(references, list):
        references[:] = [item for item in references if not (isinstance(item, dict) and item.get("id") in gone_references)]
