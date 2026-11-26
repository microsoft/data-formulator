"""past_sessions: read the user's other saved sessions and copy from them (design-docs/75).

One read-only tool. Another session is read through the same views this session uses (``SessionLayer`` and
``SessionFiles`` over that session's workspace and saved state), limited to its results: tables, charts, reports
and workspace files. Its conversation (index, threads, prompts), notes and app files are never returned. Nothing
here writes to the other session; a copy lands in this session's scratch/ or as a new item here.
"""

from __future__ import annotations

import difflib
import hashlib
import io
import json
import mimetypes
from types import SimpleNamespace
from typing import Any

from data_formulator.analyst import names
from data_formulator.analyst.skills.base import SkillContext, ToolResult

MAX_ITEMS = 10
MAX_SCANNED = 60
MAX_FOUND = 15
MAX_TITLES = 8
MAX_LISTED = 60
SCRATCH_FOLDER = "past"
_FOLDERS = ("tables", "charts", "reports")
# Notes and the old memory store are the agent's working notes, kept out like the conversation.
_PRIVATE_FILES = ("notes/", "memory/")
_NOT_SHARED = "past_sessions reads results (tables, charts, reports, files)"


class PastSession:
    """One of the user's other sessions, opened read-only."""

    def __init__(self, entry: dict[str, Any], workspace: Any, state: dict[str, Any] | None):
        from data_formulator.analyst.session_files import SessionFiles
        from data_formulator.analyst.session_layer import SessionLayer
        self.id = entry["id"]
        self.name = entry.get("display_name") or entry["id"]
        self.updated = entry.get("updated_at")
        self.workspace = workspace
        self.layer = SessionLayer(state or {}, workspace)
        self.files = SessionFiles(SimpleNamespace(workspace=workspace, payload={
            "session_layer": self.layer, "workspace_id": self.id, "in_workflow_run": True}))

    @property
    def label(self) -> dict[str, Any]:
        return {"session": self.id, "name": self.name, **({"updated": self.updated} if self.updated else {})}


def _manager(ctx: SkillContext) -> tuple[str, Any]:
    from data_formulator.analyst.skills.configure.forms import identity_of
    from data_formulator.workspace_factory import get_workspace_manager
    identity = identity_of(ctx)
    return identity, get_workspace_manager(identity)


def _others(manager: Any, ctx: SkillContext) -> list[dict[str, Any]]:
    current = ctx.payload.get("workspace_id")
    return [entry for entry in manager.list_workspaces() if entry.get("id") != current]


def _unique(values: Any) -> list[str]:
    seen: list[str] = []
    for value in values:
        text = " ".join(str(value or "").split())[:120]
        if text and text not in seen:
            seen.append(text)
    return seen


def _titles(state: dict[str, Any] | None) -> dict[str, list[str]]:
    """What a session holds, by title, from its saved state (no rows, no conversation)."""
    state = state if isinstance(state, dict) else {}
    tables = [table for key in ("inputTables", "derivedTables") for table in state.get(key) or []
              if isinstance(table, dict)]
    return {"tables": _unique(table.get("displayId") or table.get("id") for table in tables),
            "charts": _unique(chart.get("title") for chart in state.get("charts") or [] if isinstance(chart, dict)),
            "reports": _unique(report.get("title") for report in state.get("generatedReports") or []
                               if isinstance(report, dict))}


def find(args: dict[str, Any], ctx: SkillContext) -> dict[str, Any]:
    """Sessions matching ``query`` in their names or the titles of what they hold; the most recent without one."""
    _, manager = _manager(ctx)
    terms = str(args.get("query") or "").casefold().split()
    entries = _others(manager, ctx)
    found = []
    for index, entry in enumerate(entries):
        titles: dict[str, list[str]] = {}
        if index < MAX_SCANNED:
            try:
                titles = _titles(manager.load_session_state(entry["id"]))
            except (OSError, ValueError):
                titles = {}
        text = " ".join([str(entry.get("display_name") or ""), *(title for group in titles.values() for title in group)])
        if all(term in text.casefold() for term in terms):
            found.append({
                "session": entry["id"], "name": entry.get("display_name") or entry["id"],
                **({"updated": entry["updated_at"]} if entry.get("updated_at") else {}),
                **({"scheduled_run": True} if entry.get("scheduled_run") else {}),
                **{key: values[:MAX_TITLES] for key, values in titles.items() if values},
            })
    return {
        "sessions": found[:MAX_FOUND], "total_matches": len(found),
        "note": ("Look inside one with past_sessions(session). If several could be the one the user means, ask "
                 "which." + (f" Titles were searched in the {MAX_SCANNED} most recent sessions; older ones by name "
                             "only." if len(entries) > MAX_SCANNED else "")),
    }


def open_session(session: Any, ctx: SkillContext) -> PastSession | dict[str, Any]:
    """The session ``session`` names (an id, or a name matched loosely), or the candidates when that is unclear."""
    if not isinstance(session, str) or not session.strip():
        raise ValueError("session is a session id or name from past_sessions(query)")
    identity, manager = _manager(ctx)
    wanted = session.strip()
    if wanted == ctx.payload.get("workspace_id"):
        raise ValueError("That is the current session: read it with read_file and list_files")
    entries = _others(manager, ctx)
    match = next((entry for entry in entries if entry["id"] == wanted), None)
    if match is None:
        named = {entry["id"]: str(entry.get("display_name") or "") for entry in entries}
        folded = wanted.casefold()
        ids = ([id for id, name in named.items() if name.casefold() == folded]
               or [id for id, name in named.items() if folded in name.casefold()])
        if not ids:
            close = set(difflib.get_close_matches(wanted, list(named.values()), n=5, cutoff=0.6))
            ids = [id for id, name in named.items() if name in close]
        if len(ids) != 1:
            candidates = [{"session": id, "name": named[id]} for id in ids[:MAX_FOUND]]
            return {"candidates": candidates,
                    "note": ("Several sessions match; ask the user which one." if candidates else
                             f"No session is named {wanted!r}; find it with past_sessions(query).")}
        match = next(entry for entry in entries if entry["id"] == ids[0])
    workspace = manager.open_workspace(match["id"], identity)
    return PastSession(match, workspace, manager.load_session_state(match["id"]))


def contents(past: PastSession) -> dict[str, Any]:
    """What a session holds, with the item names to read or copy."""
    layer = past.layer
    tables = []
    for table in layer.tables:
        name = layer.table_name(table)
        rows, _ = layer.table_shape(name)
        tables.append({"item": f"tables/{name}", "name": table.get("displayId") or name,
                       **({"rows": rows} if rows is not None else {}),
                       "columns": [column["name"] for column in layer.table_columns(table)]})
    charts = [{"item": f"charts/{chart['id']}", "name": layer.chart_name(chart),
               "table": layer.table_name(layer.table_by_id[chart["tableRef"]])}
              for chart in layer.charts if layer.chart_spec(chart) is not None]
    reports = [{"item": f"reports/{report['id']}", "name": layer.report_name(report)} for report in layer.reports]
    files = []
    try:
        for item in past.workspace.list_workspace_files():
            if not item.name.startswith(_PRIVATE_FILES):
                files.append({"item": f"files/{item.name}",
                              **({"name": item.display_name} if item.display_name not in (None, item.name) else {})})
    except Exception:
        pass
    listed = {"tables": tables, "charts": charts, "reports": reports, "files": files}
    more = {key: len(values) - MAX_LISTED for key, values in listed.items() if len(values) > MAX_LISTED}
    return {**past.label, **{key: values[:MAX_LISTED] for key, values in listed.items()},
            **({"not_listed": more} if more else {}),
            "note": "Read an item with past_sessions(session, item), or bring it here with copy."}


def _item_path(item: Any) -> str:
    """An item name (``tables/sales``, ``charts/c1``, ``reports/r1``, ``files/a.csv``) as that session's path."""
    if not isinstance(item, str) or not item.strip():
        raise ValueError("item is tables/<name>, charts/<id>, reports/<id> or files/<path>")
    text = item.strip().removeprefix(names.SESSION)
    if text.startswith("files/"):
        if text[len("files/"):].startswith(_PRIVATE_FILES) or ".." in text.split("/"):
            raise ValueError(f"{text} is not shared: {_NOT_SHARED}, not notes")
        return text
    folder, _, leaf = text.partition("/")
    if folder in _FOLDERS and leaf:
        return f"{names.SESSION}{folder}/{leaf}"
    if folder in ("threads", "index", "references"):
        raise ValueError(f"{text} is not shared: {_NOT_SHARED}, not the conversation")
    raise ValueError(f"{item} is not an item: use tables/<name>, charts/<id>, reports/<id> or files/<path>, as "
                     "past_sessions(session) lists them")


def _local_names(value: Any) -> Any:
    """That session's ``session://`` names as its item names (``session://tables/t`` -> ``tables/t``)."""
    if isinstance(value, str):
        return value.replace(names.SESSION, "")
    if isinstance(value, list):
        return [_local_names(item) for item in value]
    if isinstance(value, dict):
        return {key: _local_names(item) for key, item in value.items()}
    return value


def read(past: PastSession, item: Any, args: dict[str, Any]) -> dict[str, Any]:
    path = _item_path(item)
    unit = {key: args[key] for key in ("rows", "columns", "offset", "limit", "pages", "sheet") if args.get(key) is not None}
    result = past.files.read_item({"path": path, **unit})
    for key in ("content_hash", "editable"):
        result.pop(key, None)
    result = _local_names(result)
    result.pop("path", None)
    result = {"item": item, **result}
    if path.startswith((names.SESSION + "tables/", names.SESSION + "charts/")):
        result["paths_note"] = ("data_file and other paths here are that session's and are not readable from this "
                                "one; copy the item to use its data here.")
    return result


def _scratch_copy(past: PastSession, path: str, ctx: SkillContext) -> tuple[str, bytes]:
    """A table's data or a file, copied into scratch/past/<session>/; its scratch path and bytes."""
    if path.startswith(names.SESSION + "tables/"):
        name = names.leaf_of(path, "tables")
        try:
            frame = past.workspace.read_data_as_df(name)
        except Exception:
            raise ValueError(f"tables/{name} has no saved data in that session") from None
        buffer = io.BytesIO()
        frame.to_parquet(buffer, index=False)
        relative, content = f"{SCRATCH_FOLDER}/{past.id}/{name}.parquet", buffer.getvalue()
    else:
        try:
            _, content = past.workspace.read_workspace_file(path[len("files/"):])
        except (FileNotFoundError, KeyError):
            raise ValueError(f"{path} does not exist in that session") from None
        relative = f"{SCRATCH_FOLDER}/{past.id}/{path[len('files/'):]}"
    ctx.workspace.save_scratch_file(relative, content)
    return f"scratch/{relative}", content


def _copy_table(past: PastSession, name: str, ctx: SkillContext) -> dict[str, Any]:
    """The table as a new table here, made from its scratch copy; an earlier copy of it is reused."""
    import pandas as pd
    from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine
    from data_formulator.datalake.parquet_utils import sanitize_table_name

    source = f'Data Formulator session "{past.name}" ({past.id})'
    scope = f"table {name}"
    metadata = ctx.workspace.get_metadata()
    for existing in metadata.tables.values():
        acquisition = (existing.import_options or {}).get("acquisition") or {}
        if acquisition.get("source") == source and acquisition.get("scope") == scope:
            return {"kind": "table", "table_name": existing.name, "display_name": existing.original_name,
                    "item": names.table(existing.name), "reused": True,
                    "note": "Copied earlier; this is that copy. To refresh it, delete it and copy again."}
    scratch, content = _scratch_copy(past, names.table(name), ctx)
    frame = pd.read_parquet(io.BytesIO(content))
    base = sanitize_table_name(name)
    local, counter = base, 2
    while metadata.get_table(local) is not None:
        local, counter = f"{base}_{counter}", counter + 1
    display = past.layer.name_of(names.table(name)) or name
    saved = ctx.workspace.save_agent_data(
        frame, local, display_name=display[:80],
        input_sources=[{"id": scratch, "kind": "file", "content_hash": hashlib.sha256(content).hexdigest()}],
        acquisition={"source": source, "scope": scope},
    )
    input_tables = ctx.payload.setdefault("input_tables", [])
    input_tables[:] = [table for table in input_tables if table.get("name") != saved.name]
    input_tables.append({"name": saved.name, "virtual": True,
                         "rows": json.loads(frame.head(20).to_json(orient="records", date_format="iso"))})
    ctx.payload["workspace_inputs"] = WorkspaceInputEngine(ctx.workspace, input_tables).manifest
    # The columns' semantic types there, for the app to apply to the copy at once.
    original = next((table for table in past.layer.tables if past.layer.table_name(table) == name), None)
    semantics = next((info.get("fields") or {} for info in past.layer.state.get("tableSemantics") or []
                      if original is not None and info.get("tableId") == original["id"]), {})
    field_metadata = {column: {key: value for key, value in annotation.items() if key != "authored"}
                      for column, annotation in semantics.items()
                      if column in frame.columns and isinstance(annotation, dict)}
    return {"kind": "table", "table_name": saved.name, "display_name": saved.original_name,
            "item": names.table(saved.name), "row_count": saved.row_count, "content_hash": saved.content_hash,
            **({"field_metadata": field_metadata} if field_metadata else {})}


def _copy_file(past: PastSession, path: str, ctx: SkillContext) -> dict[str, Any]:
    name = path[len("files/"):]
    try:
        source, content = past.workspace.read_workspace_file(name)
    except (FileNotFoundError, KeyError):
        raise ValueError(f"{path} does not exist in that session") from None
    digest = hashlib.sha256(content).hexdigest()
    files = ctx.workspace.get_metadata().files
    leaf = name.rsplit("/", 1)[-1]
    stem, suffix = (name[:-len(leaf)] + leaf.rsplit(".", 1)[0], "." + leaf.rsplit(".", 1)[1]) if "." in leaf else (name, "")
    local, counter = name, 2
    while local in files:
        try:
            if hashlib.sha256(ctx.workspace.read_workspace_file(local)[1]).hexdigest() == digest:
                return {"kind": "file", "path": f"files/{local}", "reused": True,
                        "note": "This session already has the same file."}
        except (FileNotFoundError, KeyError):
            pass
        local, counter = f"{stem}_{counter}{suffix}", counter + 1
    saved = ctx.workspace.save_workspace_file(
        content, local, getattr(source, "media_type", None) or mimetypes.guess_type(local)[0],
        display_name=getattr(source, "display_name", None), agent_managed=True)
    return {"kind": "file", "path": f"files/{saved.name}", "content_hash": saved.content_hash,
            "display_name": saved.display_name or saved.name, "available_in_workspace": True}


def copy(past: PastSession, item: Any, where: Any, ctx: SkillContext) -> dict[str, Any]:
    if where not in ("scratch", "session"):
        raise ValueError('copy is "scratch" (a file for Python) or "session" (a new table or file here)')
    if ctx.workspace is None:
        raise ValueError("This session has no workspace to copy into")
    path = _item_path(item)
    folder = names.folder_of(path) if path.startswith(names.SESSION) else "files"
    if folder == "reports":
        raise ValueError("A report is not copied: its embeds name that session's items. Read it, copy the charts "
                         "and tables it needs, and write a new report here.")
    if folder in ("tables", "charts") and past.layer.view(path) is None:
        raise ValueError(f"{folder}/{names.leaf_of(path, folder)} is not in that session")
    if folder == "charts":
        spec = json.loads(past.layer.view(path)["content"])
        if where == "session":
            table = _copy_table(past, spec["table"], ctx)
            spec["table"] = table["table_name"]
            return {"copied": [table], "chart": spec,
                    "note": f"Make the chart here with visualize: this chart, with {table['item']} as its input."}
        scratch, _ = _scratch_copy(past, names.table(spec["table"]), ctx)
        return {"scratch": scratch, "chart": spec,
                "note": f"The chart's data is in {scratch}; make the chart here with visualize, reading it in code."}
    if where == "scratch":
        scratch, _ = _scratch_copy(past, path, ctx)
        return {"scratch": scratch,
                "note": "A temporary copy for code; cite it in input_sources when a table is made from it."}
    copied = _copy_table(past, names.leaf_of(path, "tables"), ctx) if folder == "tables" else _copy_file(past, path, ctx)
    return {"copied": [copied], "note": f'Copied from "{past.name}"; its provenance names that session.'}


def past_sessions(args: dict[str, Any], ctx: SkillContext) -> dict[str, Any]:
    if not args.get("session"):
        return find(args, ctx)
    past = open_session(args["session"], ctx)
    if isinstance(past, dict):
        return past
    items = args.get("item")
    if items is None or items == []:
        return contents(past)
    items = items if isinstance(items, list) else [items]
    if len(items) > MAX_ITEMS:
        raise ValueError(f"At most {MAX_ITEMS} items per call")
    results = []
    for item in items:
        try:
            results.append({"item": item, **copy(past, item, args["copy"], ctx)} if args.get("copy")
                           else read(past, item, args))
        except ValueError as error:
            results.append({"item": item, "error": str(error)})
    copied = [entry for result in results for entry in result.pop("copied", [])]
    return {**past.label, "items": results, **({"copied": copied} if copied else {})}


class PastSessionsSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        if name != "past_sessions":
            result: dict[str, Any] = {"error": f"past_sessions has no tool '{name}'."}
        else:
            try:
                result = past_sessions(args or {}, ctx)
            except ValueError as error:
                result = {"error": str(error)}
        return ToolResult(text=json.dumps(result, ensure_ascii=False, default=str))

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext):
        message = f"past_sessions has no action '{action}'."
        yield {"type": "error", "message": message}
        return message


def get_skill() -> PastSessionsSkill:
    return PastSessionsSkill()
