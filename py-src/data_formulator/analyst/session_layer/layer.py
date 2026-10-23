"""The session understanding layer (design-docs/61).

Agent-shaped views of the session state, built on demand: an index, one file per
chart, report, table, reference, and thread. Each piece of information has one view
and uses agent-facing ids (chart ids, table workspace names, report ids, reference
ids, file paths). Charts and reports are editable; accepted edits go to a per-run
overlay so later reads see them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any
from urllib.parse import quote, unquote

from .graph import ThreadGraph, Thread, build_threads
from .state import normalize_state

logger = logging.getLogger(__name__)

PLACEHOLDER_CHART_TYPES = frozenset({"Auto", "Table"})
SAMPLE_ROWS = 5
ALL_ROWS = 25  # tables this small show every row, so a read can answer without a script
MAX_MESSAGE_CHARS = 2000
MAX_INDEX_LINES = 60
_IMPORT = re.compile(r"^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*))", re.M)


def _clip(text: str, limit: int = MAX_MESSAGE_CHARS) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + "…"


def code_imports(code: str | None) -> list[str]:
    """Modules Python code imports (top-level statements)."""
    modules: list[str] = []
    for match in _IMPORT.finditer(code or ""):
        names = [match.group(1)] if match.group(1) else [name.strip() for name in match.group(2).split(",")]
        modules.extend(name for name in names if name not in modules)
    return modules


def version_tag(value: Any) -> str:
    """A short tag that changes when ``value`` does."""
    return hashlib.sha1(json.dumps(value, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:6]


_VERSION_LINE = re.compile(r"^- (?:(added|changed|removed) )?`([^`]+)`.*?(?: #([0-9a-f]{6}))?$")
_FOCUS_LINE = re.compile(r"^Focus: `([^`]+)`")


def seen_versions(messages: list[dict[str, Any]]) -> dict[str, str]:
    """The versions the agent last saw: its latest index, then the changes reported after it."""
    versions: dict[str, str] = {}
    for message in messages:
        content = message.get("content")
        text = content if isinstance(content, str) else "\n".join(
            part.get("text", "") for part in content or [] if isinstance(part, dict))
        inside = False
        for line in text.splitlines():
            # Only the index and changes sections carry versions; other sections end them.
            if line.strip() in ("[SESSION INDEX]", "[SESSION CHANGES]"):
                inside = True
                if line.strip() == "[SESSION INDEX]":
                    versions = {}
                continue
            if line.startswith("["):
                inside = False
            if not inside:
                continue
            focus = _FOCUS_LINE.match(line)
            if focus:
                versions["@focus"] = focus.group(1)
                continue
            match = _VERSION_LINE.match(line)
            if not match:
                continue
            action, path, tag = match.groups()
            if action == "removed":
                versions.pop(path, None)
            elif tag:
                versions[path] = tag
    return versions


def has_seen_index(messages: list[dict[str, Any]]) -> bool:
    """Whether the conversation already showed the session index (a user message with the index section)."""
    return any(message.get("role") == "user" and isinstance(message.get("content"), str)
               and "[SESSION INDEX]" in message["content"].splitlines() for message in messages)


def encoding_fingerprint(chart: dict[str, Any]) -> str:
    """``computeEncodingFingerprint`` in src/components/ComponentType.tsx."""
    tuples = sorted(f"{channel}:{(encoding or {}).get('fieldID') or ''}:{(encoding or {}).get('aggregate') or ''}"
                    for channel, encoding in (chart.get("encodingMap") or {}).items())
    return f"{chart.get('chartType')}|{'|'.join(tuples)}"


def _indent(text: str) -> str:
    return "\n".join(f"    {line}" for line in text.splitlines())


def _plain(value: Any) -> Any:
    """A numpy scalar as a plain number."""
    return value.item() if hasattr(value, "item") else value


def _json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n"



def _chart_note(table: str, columns: list[str]) -> str:
    data = (f"Its data: session/tables/{table}.json (transformation code and sample rows); read it with this chart "
            "in one read_file call, or compute on it with Python. ") if table else ""
    return (data + f"Edit chart_type, encodings (fields are columns of {table or 'its table'}: {', '.join(columns)}), "
            "config, title, subtitle, or theme; the table cannot change. Invalid edits are rejected with the reasons.")

class SessionLayer:
    def __init__(self, state: Any, workspace: Any = None):
        self.state = normalize_state(state)
        self.workspace = workspace
        # Accepted edits and charts made in this run: path -> view.
        self.overlay: dict[str, dict[str, Any]] = {}
        self._rebuild()

    # -- model ----------------------------------------------------------------

    def _rebuild(self) -> None:
        state = self.state
        self.tables = [*state["inputTables"], *state["derivedTables"]]
        self.table_by_id = {table["id"]: table for table in self.tables if isinstance(table.get("id"), str)}
        self.fields = {field["id"]: field for field in state["conceptShelfItems"] if isinstance(field.get("id"), str)}
        self.charts = [chart for chart in state["charts"] if isinstance(chart.get("id"), str)]
        self.reports = [report for report in state["generatedReports"]
                        if isinstance(report.get("id"), str) and report.get("status") != "generating"]
        self.references = [reference for reference in state["externalTableReferences"] if isinstance(reference.get("id"), str)]
        self.graph = ThreadGraph.from_state(state)
        self.threads = [thread for thread in build_threads(self.graph) if not self._lone_source(thread)]
        self._cache: dict[str, dict[str, Any] | None] = {}
        self.__dict__.pop("_blocked_cache", None)
        self._apps: list[tuple[str, set[str], set[str]]] | None = None

    def _lone_source(self, thread: Thread) -> bool:
        """A source table with nothing after it stays on the shelf, not in a thread."""
        return len(thread.node_ids) == 1 and self.graph.kind_of(thread.node_ids[0]) == "table" \
            and not (self.table_by_id.get(thread.node_ids[0]) or {}).get("derive")

    @staticmethod
    def table_name(table: dict[str, Any]) -> str:
        if table.get("derive") is not None or table.get("kind") == "table":
            return str((table.get("virtual") or {}).get("tableId") or table["id"])
        source = table.get("source") or {}
        if source.get("kind") == "workspace" and source.get("tableId"):
            return str(source["tableId"])
        return str(source.get("workspaceTableId") or table["id"])

    def table_columns(self, table: dict[str, Any]) -> list[dict[str, Any]]:
        semantics = next((info.get("fields") or {} for info in self.state["tableSemantics"]
                          if info.get("tableId") == table["id"]), {})
        if isinstance(table.get("snapshot"), dict):
            columns = [{"name": column["name"], "type": column.get("type"), "description": column.get("description")}
                       for column in table["snapshot"].get("columns") or [] if isinstance(column, dict) and column.get("name")]
        else:
            metadata = table.get("metadata") or {}
            columns = [{"name": name, "type": (metadata.get(name) or {}).get("type")} for name in table.get("names") or []]
        for column in columns:
            meaning = semantics.get(column["name"]) or {}
            for source, target in (("semanticType", "semantic_type"), ("displayName", "display_name"), ("unit", "unit")):
                if meaning.get(source):
                    column[target] = meaning[source]
        return [{key: value for key, value in column.items() if value not in (None, "")} for column in columns]

    def row_count(self, table: dict[str, Any]) -> int | None:
        if isinstance(table.get("snapshot"), dict):
            return table["snapshot"].get("rowCount")
        return (table.get("virtual") or {}).get("rowCount")

    def chart_name(self, chart: dict[str, Any]) -> str:
        table = self.table_by_id.get(chart.get("tableRef"))
        return chart.get("title") or f"{chart.get('chartType')} of {(table or {}).get('displayId') or chart.get('tableRef')}"

    def name_of(self, path: str) -> str | None:
        """The name the user sees for a session path, without building its view."""
        folder, _, leaf = path[len("session/"):].partition("/") if path.startswith("session/") else ("", "", "")
        stem = leaf.rsplit(".", 1)[0]
        if folder == "tables":
            table = next((table for table in self.tables if self.table_name(table) == stem), None)
            if table is not None:
                return str(table.get("displayId") or stem)
            metadata = self.workspace.get_table_metadata(stem) if self.workspace is not None else None
            return str(getattr(metadata, "original_name", None) or stem) if metadata is not None else None
        if folder == "charts":
            chart = next((chart for chart in self.charts if chart["id"] == stem), None)
            return self.chart_name(chart) if chart else (self.overlay.get(path) or {}).get("name")
        if folder == "reports":
            report = next((report for report in self.reports if report["id"] == stem), None)
            return self.report_name(report) if report else None
        if folder == "references":
            reference = next((reference for reference in self.references if reference["id"] == stem), None)
            return reference.get("displayName") if reference else None
        if folder == "threads":
            return f"Thread {stem}"
        if path == "session/index.md":
            return "Session index"
        return None

    def table_code(self, name: str) -> str:
        """The code that derived a session table, or "" for a loaded one."""
        table = next((table for table in self.tables if self.table_name(table) == name), None)
        return str(((table or {}).get("derive") or {}).get("code") or "")

    def table_shape(self, name: str) -> tuple[int | None, int | None]:
        """(rows, columns) of a session table, from the session state or the workspace."""
        table = next((table for table in self.tables if self.table_name(table) == name), None)
        if table is not None:
            return self.row_count(table), len(self.table_columns(table))
        metadata = self.workspace.get_table_metadata(name) if self.workspace is not None else None
        if metadata is None:
            return None, None
        return metadata.row_count, len(metadata.columns or [])

    # -- dependencies ---------------------------------------------------------

    def _input_names(self, table: dict[str, Any], kind: str) -> list[str]:
        sources = [*((table.get("derive") or {}).get("inputSources") or []),
                   *((table.get("dataProvenance") or {}).get("inputSources") or [])]
        names = []
        for source in sources:
            if isinstance(source, dict) and source.get("kind") == kind and isinstance(source.get("id"), str):
                name = unquote(source["id"].rsplit(":", 1)[-1])
                name = name[len("files/"):] if kind == "file" and name.startswith("files/") else name
                if name not in names:
                    names.append(name)
        return names

    def computed_from(self, table: dict[str, Any], source: dict[str, Any]) -> bool:
        derive = table.get("derive") or {}
        return (source["id"] in (derive.get("source") or []) or (derive.get("trigger") or {}).get("tableId") == source["id"]
                or self.table_name(source) in self._input_names(table, "data"))

    def computed_into(self, source: dict[str, Any]) -> list[dict[str, Any]]:
        return [table for table in self.tables if table["id"] != source["id"] and self.computed_from(table, source)]

    def report_name(self, report: dict[str, Any]) -> str:
        return report.get("title") or report["id"]

    def report_content(self, report: dict[str, Any]) -> str:
        """A report's text as of now: an edit made earlier in this run counts."""
        edited = self.overlay.get(f"session/reports/{report['id']}.md")
        return str(edited["content"]) if edited else (report.get("content") or "")

    def reports_showing(self, chart_id: str) -> list[str]:
        return [self.report_name(report) for report in self.reports if f"chart://{chart_id}" in self.report_content(report)]

    def charts_of(self, table: dict[str, Any]) -> list[dict[str, Any]]:
        return [chart for chart in self.charts if chart.get("tableRef") == table["id"]]

    def reports_using(self, table: dict[str, Any]) -> list[str]:
        names = [self.report_name(report) for report in self.reports if report.get("triggerTableId") == table["id"]]
        for chart in self.charts_of(table):
            names.extend(name for name in self.reports_showing(chart["id"]) if name not in names)
        return names

    def apps_reading(self, name: str) -> list[str]:
        if self._apps is None:
            self._apps = []
            if self.workspace is not None:
                try:
                    from data_formulator.analyst.skills.html_app.skill import read_html_manifest, read_react_manifest
                    for item in self.workspace.list_workspace_files():
                        lower = item.name.lower()
                        if not (lower.endswith(".app.jsx") or lower.endswith(".html")):
                            continue
                        _, content = self.workspace.read_workspace_file(item.name)
                        text = content.decode("utf-8", errors="replace")
                        manifest = read_react_manifest(text) if lower.endswith(".app.jsx") else read_html_manifest(text)
                        if manifest:
                            self._apps.append((f"files/{item.name}", {str(t) for t in manifest.get("tables") or []},
                                               {str(s) for s in manifest.get("sources") or []}))
                except Exception:
                    logger.warning("Could not read app manifests", exc_info=True)
        return [path for path, tables, sources in self._apps if name in tables or name in sources]

    def items(self) -> dict[str, list[dict[str, Any]]]:
        """Tables, charts, and references with what depends on each (for deletion checks)."""
        tables = []
        for table in self.tables:
            name = self.table_name(table)
            files = self._input_names(table, "file")
            imports = code_imports((table.get("derive") or {}).get("code"))
            tables.append({
                "id": name, "node_id": table["id"], "name": table.get("displayId") or name,
                "origin": "derived" if table.get("derive") else "loaded",
                **({"aliases": [table["id"]]} if table["id"] != name else {}),
                "charts": [chart["id"] for chart in self.charts_of(table)],
                "computed_into": [other["id"] for other in self.computed_into(table)],
                "reports": self.reports_using(table),
                "reports_made_from": [self.report_name(report) for report in self.reports
                                      if report.get("triggerTableId") == table["id"]],
                **({"files": files} if files else {}), **({"imports": imports} if imports else {}),
            })
        charts = [{"id": chart["id"], "name": self.chart_name(chart), "table": chart.get("tableRef"),
                   "reports": self.reports_showing(chart["id"])} for chart in self.charts]
        references = [{"id": reference["id"], "name": reference.get("displayName") or reference["id"],
                       "computed_into": [table["id"] for table in self.tables
                                         if ((table.get("derive") or {}).get("trigger") or {}).get("externalReferenceId") == reference["id"]
                                         or reference["id"] in ((table.get("derive") or {}).get("source") or [])]}
                      for reference in self.references]
        return {"tables": tables, "charts": charts, "references": references}

    def replaceable(self, focus_node_id: str | None = None, limit: int = 60) -> list[dict[str, Any]]:
        """What the agent may replace to fix (design-docs/60), with why some cannot be replaced.

        Mirrors ``listReplaceableArtifacts`` in src/app/artifactReplacement.ts (shared fixture).
        """
        all_reports = self.state["generatedReports"]
        entries: list[tuple[dict[str, Any], float]] = []
        for table in self.tables:
            if not table.get("derive"):
                continue
            charts = self.charts_of(table)
            chart_ids = [chart["id"] for chart in charts]
            derived_from = next((other for other in self.tables if other["id"] != table["id"]
                                 and table["id"] in ((other.get("derive") or {}).get("source") or [])), None)
            authored = [chart for chart in charts if chart.get("source") != "trigger"]
            agent_chart, later = (authored[0], authored[1:]) if authored else (None, [])
            edited = bool(agent_chart) and bool(
                agent_chart.get("titleKey") and agent_chart["titleKey"] != encoding_fingerprint(agent_chart))
            report = next((report for report in all_reports if report.get("triggerTableId") == table["id"]
                           or any(f"chart://{id}" in self.report_content(report) for id in chart_ids)), None)
            name = self.table_name(table)
            blocked = (f"the table {derived_from.get('displayId') or derived_from['id']} was computed from it" if derived_from
                       else "another chart was made from it" if later
                       else "the user edited its chart" if edited
                       else f"the report {report.get('title') or report['id']} uses it" if report else None)
            aliases = ([table["id"]] if table["id"] != name else []) + chart_ids
            entries.append(({"id": name, "node_id": table["id"], "kind": "table", "name": table.get("displayId") or name,
                             **({"aliases": aliases} if aliases else {}), **({"blocked": blocked} if blocked else {})},
                            float(table.get("createdAt") or 0)))
        for file in self.state["fileNodes"]:
            path = str(file.get("path") or "")
            encoded = quote(path, safe="!*'()~")
            used_by = next((table for table in self.tables if any(
                isinstance(source, dict) and source.get("kind") == "file"
                and (source.get("displayName") == path or str(source.get("id") or "").endswith(f":{encoded}"))
                for source in (table.get("derive") or {}).get("inputSources") or [])), None)
            entries.append(({"id": f"files/{path}", "node_id": file["id"], "kind": "file",
                             "name": file.get("displayName") or path,
                             **({"blocked": f"the table {used_by.get('displayId') or used_by['id']} was computed from it"}
                                if used_by else {})}, float(file.get("createdAt") or 0)))
        for report in all_reports:
            if report.get("status") == "generating":
                continue
            entries.append(({"id": report["id"], "node_id": report["id"], "kind": "report",
                             "name": report.get("title") or report["id"]}, float(report.get("createdAt") or 0)))
        chain = self.graph.ancestors(focus_node_id, include_self=True)
        rank = {node_id: index for index, node_id in enumerate(chain)}
        entries.sort(key=lambda entry: (rank.get(entry[0]["node_id"], len(chain)), -entry[1]))
        return [entry for entry, _ in entries[:limit]]

    def _blocked(self) -> dict[str, str]:
        """Node id -> why the item cannot be replaced."""
        if not hasattr(self, "_blocked_cache"):
            self._blocked_cache = {entry["node_id"]: entry["blocked"] for entry in self.replaceable(limit=10_000)
                                   if entry.get("blocked")}
        return self._blocked_cache

    def focus_node(self) -> str | None:
        """The thread node the user's focus is on."""
        focus = self.state["focusedId"] or {}
        kind = focus.get("type")
        if kind == "chart":
            chart = next((chart for chart in self.charts if chart["id"] == focus.get("chartId")), None)
            return chart.get("tableRef") if chart else None
        if kind == "file":
            return next((item["id"] for item in self.state["fileNodes"] if item.get("path") == focus.get("fileName")), None)
        return {"table": focus.get("tableId"), "conversation": focus.get("tableId"), "report": focus.get("reportId"),
                "reference": focus.get("referenceId"), "text": focus.get("textId"), "draft": focus.get("draftId")}.get(kind)

    # -- views ----------------------------------------------------------------

    def chart_spec(self, chart: dict[str, Any]) -> dict[str, Any] | None:
        """The chart as the agent edits it (must match ``chartFileSpec`` in src/app/sessionFiles.ts)."""
        table = self.table_by_id.get(chart.get("tableRef"))
        if table is None or chart.get("chartType") in PLACEHOLDER_CHART_TYPES:
            return None
        encodings: dict[str, Any] = {}
        for channel, encoding in (chart.get("encodingMap") or {}).items():
            field = self.fields.get((encoding or {}).get("fieldID"))
            if not field:
                continue
            encodings[channel] = {"field": field["name"], **{target: encoding[source] for source, target in (
                ("dtype", "type"), ("aggregate", "aggregate"), ("sortOrder", "sortOrder"), ("sortBy", "sortBy"),
                ("scheme", "scheme")) if encoding.get(source)}}
        return {
            "chart_type": chart.get("chartType"), "table": self.table_name(table),
            **({"title": chart["title"]} if chart.get("title") else {}),
            **({"subtitle": chart["subtitle"]} if chart.get("subtitle") else {}),
            "encodings": encodings,
            **({"config": chart["config"]} if chart.get("config") else {}),
            **({"theme": chart["themeId"]} if chart.get("themeId") else {}),
        }

    def thread_number(self, node_id: str | None) -> int | None:
        if not node_id:
            return None
        for number, thread in enumerate(self.threads, start=1):
            if node_id in thread.node_ids or any(node_id in self.graph.members_of(id) for id in thread.node_ids):
                return number
        return None

    def paths(self) -> list[str]:
        paths = ["session/index.md"]
        paths += [f"session/charts/{chart['id']}.json" for chart in self.charts if self.chart_spec(chart) is not None]
        paths += [path for path in self.overlay if path.startswith("session/charts/") and path not in paths]
        paths += [f"session/reports/{report['id']}.md" for report in self.reports]
        paths += [f"session/tables/{self.table_name(table)}.json" for table in self.tables]
        paths += [f"session/tables/{name}.json" for name in self._unlisted_tables()]
        paths += [f"session/references/{reference['id']}.json" for reference in self.references]
        paths += [f"session/threads/{number}.md" for number in range(1, len(self.threads) + 1)]
        return paths

    def view(self, path: str) -> dict[str, Any] | None:
        """The view at ``path`` ({content, editable?, name?, note?, columns?}), or None."""
        if path in self.overlay:
            return self.overlay[path]
        if self._cache.get(path) is None:
            try:
                self._cache[path] = self._build(path)
            except Exception:
                logger.warning("Could not build %s", path, exc_info=True)
                self._cache[path] = None
        return self._cache[path]

    def _build(self, path: str) -> dict[str, Any] | None:
        if path == "session/index.md":
            return {"content": self.index(), "name": "Session index"}
        folder, _, leaf = path[len("session/"):].partition("/")
        stem = leaf.rsplit(".", 1)[0]
        if folder == "charts" and leaf.endswith(".json"):
            chart = next((chart for chart in self.charts if chart["id"] == stem), None)
            spec = self.chart_spec(chart) if chart else None
            if spec is None:
                return None
            table = self.table_by_id[chart["tableRef"]]
            columns = [column["name"] for column in self.table_columns(table)]
            return {"content": _json(spec), "editable": True, "name": self.chart_name(chart), "columns": columns,
                    "note": _chart_note(spec["table"], columns)}
        if folder == "reports" and leaf.endswith(".md"):
            report = next((report for report in self.reports if report["id"] == stem), None)
            return None if report is None else {"content": report.get("content") or "", "editable": True,
                                                "name": self.report_name(report)}
        if folder == "tables" and leaf.endswith(".json"):
            table = next((table for table in self.tables if self.table_name(table) == stem), None)
            if table is None:
                return self._unlisted_table_view(stem)
            return {"content": _json(self._table_view(table)), "name": table.get("displayId") or stem}
        if folder == "references" and leaf.endswith(".json"):
            reference = next((reference for reference in self.references if reference["id"] == stem), None)
            return None if reference is None else {"content": _json(self._reference_view(reference)),
                                                   "name": reference.get("displayName") or stem}
        if folder == "threads" and leaf.endswith(".md") and stem.isdigit() and 1 <= int(stem) <= len(self.threads):
            return {"content": self._thread_view(int(stem)), "name": f"Thread {stem}"}
        return None

    def _descriptions(self) -> tuple[dict[str, str], dict[str, dict[str, str]], dict[str, str], dict[str, list[str]],
                                     dict[str, dict[str, dict]]]:
        """Table and column descriptions from workspace metadata and connector catalogs (cached per layer)."""
        if not hasattr(self, "_description_cache"):
            tables: dict[str, str] = {}
            columns: dict[str, dict[str, str]] = {}
            provenance: dict[str, str] = {}
            extras: dict[str, list[str]] = {}
            metas: dict[str, dict[str, dict]] = {}
            if self.workspace is not None:
                try:
                    from data_formulator.agents.agent_utils import build_catalog_metadata_lookups
                    from data_formulator.agents.context import _get_workspace_metadata_lookups
                    tables, columns, provenance = _get_workspace_metadata_lookups(self.workspace)
                    catalog_tables, catalog_columns, extras, metas = build_catalog_metadata_lookups(self.workspace)
                    tables = {**catalog_tables, **tables}
                    for table_name, described in catalog_columns.items():
                        columns[table_name] = {**described, **columns.get(table_name, {})}
                except Exception:
                    logger.debug("Could not read table descriptions", exc_info=True)
            self._description_cache = (tables, columns, provenance, extras, metas)
        return self._description_cache

    def _data_profile(self, name: str, columns: list[dict[str, Any]]) -> dict[str, Any]:
        """What the workspace knows about a table's data: file, descriptions, values, rows."""
        if self.workspace is None:
            return {}
        profile: dict[str, Any] = {}
        try:
            profile["file"] = self.workspace.get_relative_data_file_path(name)
        except Exception:
            pass
        tables, described, provenance, extras, metas = self._descriptions()
        if tables.get(name):
            profile["description"] = tables[name]
        if provenance.get(name):
            profile["loaded_with"] = provenance[name]
        if extras.get(name):
            profile["catalog_notes"] = extras[name]
        try:
            frame = self.workspace.read_data_as_df(name)
        except Exception:
            return profile
        from data_formulator.agents.agent_utils import get_field_summary
        by_name = {column["name"]: column for column in columns}
        for column_name in frame.columns:
            column = by_name.get(str(column_name))
            if column is None:
                continue
            meta = (metas.get(name) or {}).get(column_name, {})
            if (described.get(name) or {}).get(column_name) and not column.get("description"):
                column["description"] = described[name][column_name]
            for key in ("verbose_name", "expression"):
                if meta.get(key):
                    column[key] = meta[key]
            summary = get_field_summary(column_name, frame, field_sample_size=7, max_val_chars=80)
            if "values: " in summary:
                column["values"] = summary.split("values: ", 1)[1]
            series = frame[column_name]
            if series.dtype.kind in "iuf" and series.notna().any():
                column["range"] = {"min": _plain(series.min()), "max": _plain(series.max()), "mean": round(float(series.mean()), 4)}
        key = "rows" if len(frame) <= ALL_ROWS else "sample_rows"
        profile[key] = json.loads(frame.head(ALL_ROWS if key == "rows" else SAMPLE_ROWS)
                                  .to_json(orient="records", date_format="iso"))
        return profile

    def _table_view(self, table: dict[str, Any]) -> dict[str, Any]:
        """Everything about a table: the file to read, columns with values, and links."""
        name = self.table_name(table)
        derive = table.get("derive") or {}
        sources = [self.table_by_id[id] for id in derive.get("source") or [] if id in self.table_by_id]
        columns = self.table_columns(table)
        profile = self._data_profile(name, columns)
        rows = profile.pop("rows", None)
        samples = profile.pop("sample_rows", None)
        return {
            "name": name, "display_name": table.get("displayId"), "origin": "derived" if derive else "loaded",
            **({"description": table["description"]} if table.get("description") else {}),
            **profile,
            "columns": columns, "row_count": self.row_count(table),
            **({"rows": rows} if rows is not None else {}),
            **({"sample_rows": samples} if samples is not None else {}),
            **({"derived_from": [self.table_name(source) for source in sources], "code": derive.get("code")} if derive else {}),
            **({"from_reference": derive["trigger"]["externalReferenceId"]}
               if (derive.get("trigger") or {}).get("externalReferenceId") else {}),
            **({"input_files": files} if (files := self._input_names(table, "file")) else {}),
            "charts": [f"session/charts/{chart['id']}.json" if self.chart_spec(chart) else chart["id"]
                       for chart in self.charts_of(table)],
            **({"computed_into": [self.table_name(other) for other in computed]} if (computed := self.computed_into(table)) else {}),
            **({"reports_using": reports} if (reports := self.reports_using(table)) else {}),
            **({"apps_reading": apps} if (apps := self.apps_reading(name)) else {}),
            **({"thread": f"session/threads/{number}.md"} if (number := self.thread_number(table["id"])) else {}),
        }

    def _unlisted_tables(self) -> list[str]:
        """Workspace tables the session does not show yet: made during this run, or never put on the canvas."""
        if self.workspace is None:
            return []
        try:
            names = self.workspace.list_tables()
        except Exception:
            return []
        shown = {self.table_name(table) for table in self.tables}
        return [name for name in names if isinstance(name, str) and name not in shown]

    def _unlisted_table_view(self, name: str) -> dict[str, Any] | None:
        if name not in self._unlisted_tables():
            return None
        metadata = self.workspace.get_table_metadata(name)
        if metadata is None:
            return None
        table = {"kind": "input-table", "id": name, "displayId": metadata.original_name or name,
                 "source": {"kind": "workspace", "tableId": name},
                 "snapshot": {"columns": [{"name": column.name, "type": column.dtype, "description": column.description}
                                          for column in metadata.columns or []], "rowCount": metadata.row_count}}
        view = {**self._table_view(table), "origin": metadata.origin or metadata.source_type}
        if metadata.description:
            view.setdefault("description", metadata.description)
        return {"content": _json(view), "name": table["displayId"],
                "note": "A workspace table the session does not show yet (made during this run, or not on the canvas)."}

    def _reference_view(self, reference: dict[str, Any]) -> dict[str, Any]:
        from data_formulator.analyst.workspace_inputs import normalize_external_references
        # Normalized as tools see it: bounded sample rows, untrusted text trimmed.
        reference = next(iter(normalize_external_references([reference])), reference)
        view = {key: reference[key] for key in ("id", "displayName", "connectorId", "connectorName", "tableKey",
                                                 "sourceTable", "sourceLocation", "queryModel", "queryIntent",
                                                 "capturedAt", "summary")
                if reference.get(key) is not None}
        try:
            from data_formulator.data_connector import get_query_capabilities
            view["query_capabilities"] = get_query_capabilities(reference.get("connectorId"))
        except Exception:
            pass
        derived = [self.table_name(table) for table in self.tables
                   if ((table.get("derive") or {}).get("trigger") or {}).get("externalReferenceId") == reference["id"]]
        if derived:
            view["computed_into"] = derived
        apps = self.apps_reading(reference["id"])
        if apps:
            view["apps_reading"] = apps
        return view

    def _describe(self, node_id: str) -> list[str]:
        kind = self.graph.kind_of(node_id)
        state = self.state
        if kind in ("turn", "workflow-definition"):
            turn = next((turn for turn in state["textTurns"] if turn.get("id") == node_id), None)
            return self._describe_turn(turn, kind) if turn else []
        if kind == "table":
            table = self.table_by_id.get(node_id)
            if not table:
                return []
            charts = [f"session/charts/{chart['id']}.json" for chart in self.charts_of(table) if self.chart_spec(chart)]
            return [f"- **Table** session/tables/{self.table_name(table)}.json \"{table.get('displayId')}\""
                    + (f" — charts {', '.join(charts)}" if charts else "")]
        if kind == "loaded-table":
            node = self.graph.nodes[node_id]
            table = self.table_by_id.get(node.table_id or "")
            if table:
                return [f"- **Loaded** session/tables/{self.table_name(table)}.json"]
            return [f"- **Added reference** session/references/{node.table_id}.json"]
        if kind == "report":
            report = next((report for report in self.reports if report["id"] == node_id), None)
            return [f"- **Report** session/reports/{node_id}.md \"{self.report_name(report)}\""] if report else []
        if kind == "file":
            node = next((node for node in state["fileNodes"] if node.get("id") == node_id), None)
            return [f"- **File** files/{node.get('path')}" + (f" \"{node['displayName']}\"" if node.get("displayName") else "")] \
                if node else []
        if kind == "artifact-set":
            return [line for member in self.graph.members_of(node_id) for line in self._describe(member)]
        return []

    def _describe_turn(self, turn: dict[str, Any], kind: str) -> list[str]:
        lines = []
        if turn.get("prompt"):
            lines.append(f"- **User:** {_clip(str(turn['prompt']))}")
        thoughts = [str(step.get("label") or "") for step in turn.get("progressSteps") or []
                    if isinstance(step, dict) and step.get("kind") == "thought" and step.get("label")]
        if thoughts:
            lines.append(f"  - *Agent thinking:* {_clip(' '.join(thoughts), 1500)}")
        plan = [item for item in turn.get("plan") or [] if isinstance(item, dict) and item.get("text")]
        if plan:
            marks = {"done": "[x]", "dropped": "[dropped]"}
            title = f"{_clip(str(turn['planTitle']), 120)}: " if turn.get("planTitle") else ""
            lines.append(f"  - *Plan:* {title}" + "; ".join(
                f"{marks.get(item.get('status'), '[ ]')} {_clip(str(item['text']), 200)}" for item in plan))
        if turn.get("content"):
            # The agent message right before a derived table is that table's instruction.
            follower = next(iter(self.graph.followers_of(turn["id"])), None)
            made_table = follower is not None and (self.table_by_id.get(follower.id) or {}).get("derive")
            lines.append(f"- **{'Agent (instruction for the next table)' if made_table else 'Agent'}:** {_clip(str(turn['content']))}")
        form = turn.get("form") or {}
        if form.get("kind") == "workflow":
            workflow = form.get("workflow") or {}
            saved = (workflow.get("saved") or {}).get("path")
            lines.append("- **Workflow proposal**" + (f" (saved as {saved})" if saved else " (not saved)") + ":\n\n"
                         + _indent(_clip(str(workflow.get("content") or ""), 8000)))
        elif form.get("kind"):
            lines.append(f"- **{str(form['kind']).capitalize()} form** shown to the user")
        run = turn.get("workflow") or {}
        if run.get("runId"):
            steps = ", ".join(f"{step.get('id')} ({step.get('status')})" for step in run.get("steps") or [] if isinstance(step, dict))
            checks = ", ".join(f"{check.get('id')}: {check.get('status')}" for check in run.get("checks") or [] if isinstance(check, dict))
            lines.append(f"- **Workflow run** {run['runId']}: {run.get('status')}, at step {run.get('stepId')}"
                         + (f"; steps {steps}" if steps else "") + (f"; checks {checks}" if checks else ""))
            outputs = [self._output_link(id) for id in turn.get("outputIds") or []]
            if outputs:
                lines.append(f"  - outputs: {', '.join(outputs)}")
        operation = turn.get("dataOperation") or {}
        if operation:
            plans = [plan for plan in operation.get("plans") or [] if isinstance(plan, dict)]
            selected = next((plan.get("label") for plan in plans if plan.get("id") == operation.get("selectedPlanId")), None)
            results = [self._output_link(id) for id in operation.get("resultTableIds") or []]
            results += [f"session/references/{ref.get('id')}.json" for ref in operation.get("resultReferences") or [] if isinstance(ref, dict)]
            lines.append(f"- **Data load** ({operation.get('status', '')}): {_clip(str(operation.get('reason', '')), 400)}"
                         + (f"; options: {', '.join(str(plan.get('label')) for plan in plans)}" if plans else "")
                         + (f"; chosen: {selected}" if selected else "")
                         + (f"; loaded: {', '.join(results)}" if results else ""))
        for execution in turn.get("executions") or []:
            if isinstance(execution, dict) and execution.get("argv"):
                lines.append(f"- **Command** `{' '.join(map(str, execution['argv']))[:200]}` ({execution.get('status', '')})")
        return lines

    def _output_link(self, id: str) -> str:
        if id in self.table_by_id:
            return f"session/tables/{self.table_name(self.table_by_id[id])}.json"
        if any(report["id"] == id for report in self.reports):
            return f"session/reports/{id}.md"
        if any(chart["id"] == id for chart in self.charts):
            return f"session/charts/{id}.json"
        return id

    def _thread_view(self, number: int) -> str:
        thread = self.threads[number - 1]
        root = self.table_by_id.get(thread.root_id)
        lines = [f"# Thread {number}" + (f" (from {self.table_name(root)})" if root else "")
                 + (f" — branches from {self._node_label(thread.branch_from_id)}" if thread.branch_from_id else "")]
        if number == self.focus()[1]:
            lines.append("The user is working in this thread.")
        lines.append("")
        for node_id in thread.node_ids:
            lines.extend(self._describe(node_id))
        return "\n".join(lines) + "\n"

    def _node_label(self, node_id: str | None) -> str:
        if node_id in self.table_by_id:
            return f"table {self.table_name(self.table_by_id[node_id])}"
        return f"thread {self.thread_number(node_id)}" if self.thread_number(node_id) else str(node_id)

    # -- focus and index -------------------------------------------------------

    def reference_of(self, node_id: str | None) -> str | None:
        """The connected-source reference a conversation at ``node_id`` is about: the nearest one above it."""
        known = {reference["id"] for reference in self.references}
        for current in self.graph.ancestors(node_id, include_self=True):
            turn = next((turn for turn in self.state["textTurns"] if turn.get("id") == current), None)
            table = self.table_by_id.get(current)
            draft = next((draft for draft in self.state["draftNodes"] if draft.get("id") == current), None)
            node = self.graph.nodes.get(current)
            for candidate in ((turn or {}).get("externalReferenceId"),
                              (((table or {}).get("derive") or {}).get("trigger") or {}).get("externalReferenceId"),
                              (((draft or {}).get("derive") or {}).get("trigger") or {}).get("externalReferenceId"),
                              node.table_id if node is not None and node.kind == "loaded-table" else None):
                if candidate in known:
                    return candidate
        return None

    def tables_behind(self, path: str | None) -> list[str]:
        """The tables a chart or derived table on the canvas shows and was computed from, nearest first."""
        table = None
        if path and path.startswith("session/charts/"):
            chart = next((chart for chart in self.charts if f"session/charts/{chart['id']}.json" == path), None)
            table = self.table_by_id.get((chart or {}).get("tableRef"))
            shown = [table] if table else []
        elif path and path.startswith("session/tables/"):
            table = next((table for table in self.tables if f"session/tables/{self.table_name(table)}.json" == path), None)
            shown = []
        if table is None:
            return []
        sources = [self.table_by_id[id] for id in (table.get("derive") or {}).get("source") or [] if id in self.table_by_id]
        return list(dict.fromkeys(f"session/tables/{self.table_name(item)}.json" for item in [*shown, *sources]))

    def focus_line(self) -> str:
        """Where the user is: what is on the canvas, the thread they work in, the reference it is about."""
        path, thread = self.focus()
        if not path and not thread:
            return ""
        reference = self.reference_of(self.focus_node())
        reference_path = f"session/references/{reference}.json" if reference else None
        return "Focus: " + ", ".join(filter(None, [
            f"`{path}` is on the canvas{self._file_status(path)}" if path else None,
            f"the user is working in `session/threads/{thread}.md`" if thread else None,
            f"about `{reference_path}`" if reference_path and reference_path != path else None]))

    def focus(self) -> tuple[str | None, int | None]:
        """What the user is looking at (a view path) and the thread they are working in."""
        focus = self.state["focusedId"] or {}
        kind = focus.get("type")
        node = None
        path = None
        if kind == "chart":
            chart = next((chart for chart in self.charts if chart["id"] == focus.get("chartId")), None)
            if chart:
                path = f"session/charts/{chart['id']}.json" if self.chart_spec(chart) else None
                node = chart.get("tableRef")
                if path is None and node in self.table_by_id:
                    path = f"session/tables/{self.table_name(self.table_by_id[node])}.json"
        elif kind in ("table", "conversation"):
            node = focus.get("tableId")
            if node in self.table_by_id:
                path = f"session/tables/{self.table_name(self.table_by_id[node])}.json"
        elif kind == "report":
            node = focus.get("reportId")
            path = f"session/reports/{node}.md" if any(report["id"] == node for report in self.reports) else None
        elif kind == "file":
            name = str(focus.get("fileName") or "")
            path = name if name.startswith("scratch/") else f"files/{name}"
            node = self.focus_node()
        elif kind == "external-table":
            path = f"session/references/{focus.get('referenceId')}.json"
        elif kind == "reference":
            node = focus.get("referenceId")
            graph_node = self.graph.nodes.get(node or "")
            if graph_node and graph_node.kind == "loaded-table":
                table = self.table_by_id.get(graph_node.table_id or "")
                path = f"session/tables/{self.table_name(table)}.json" if table else f"session/references/{graph_node.table_id}.json"
            elif graph_node and graph_node.kind == "file":
                file = next((item for item in self.state["fileNodes"] if item.get("id") == node), None)
                path = f"files/{file.get('path')}" if file else None
        elif kind == "text":
            node = focus.get("textId")
        elif kind == "draft":
            node = focus.get("draftId")
        return path, self.thread_number(node)

    def index(self) -> str:
        """The session index: every item once, ``- `path` description #version``, with focus and flags."""
        workspace = self.state["activeWorkspace"] or {}
        lines = [f"# Session: {workspace.get('displayName') or 'untitled'}", ""]
        self.versions: dict[str, str] = {}
        path, thread = self.focus()
        if focus_line := self.focus_line():
            lines.append(focus_line)
            lines.append("Resolve \"this\" (this chart, file, data) to what is on the canvas.")
            lines.append("")

        def section(title: str, entries: list[tuple[str, str, Any]], listing: str) -> None:
            if not entries:
                return
            lines.append(f"## {title} ({len(entries)})")
            for item_path, text, value in entries[:MAX_INDEX_LINES]:
                tag = version_tag(value)
                self.versions[item_path] = tag
                # One line per item: names and requests can hold line breaks.
                text = " ".join(text.split())
                lines.append(f"- `{item_path}`{' ' + text if text else ''} #{tag}")
            if len(entries) > MAX_INDEX_LINES:
                rest = entries[MAX_INDEX_LINES:]
                tag = version_tag([value for _, _, value in rest])
                self.versions[f"{listing}+"] = tag
                lines.append(f"- `{listing}+` {len(rest)} more: list_files {listing} #{tag}")
            lines.append("")

        threads = []
        for number, item in enumerate(self.threads, start=1):
            root = self.table_by_id.get(item.root_id)
            turns = {turn.get("id"): turn for turn in self.state["textTurns"] if turn.get("prompt")}
            prompts = [turns[id] for id in item.node_ids if id in turns]
            first = _clip(" ".join(str(prompts[0]["prompt"]).split()), 80) if prompts else ""
            made = sum(1 for id in item.node_ids if self.graph.is_item(id)) - (1 if root else 0)
            threads.append((f"session/threads/{number}.md",
                            (f" from {self.table_name(root)}" if root else "") + (f" — \"{first}\"" if first else "")
                            + f" · {len(prompts)} request{'s' if len(prompts) != 1 else ''}, {max(made, 0)} item{'s' if made != 1 else ''}"
                            + (" [working here]" if number == thread else ""),
                            [self._node_state(id) for id in item.node_ids]))
        section("Threads", threads, "session/threads")

        tables = []
        for table in self.tables:
            name = self.table_name(table)
            flags = []
            derive = table.get("derive") or {}
            if derive:
                sources = [self.table_name(self.table_by_id[id]) for id in derive.get("source") or [] if id in self.table_by_id]
                flags.append("derived" + (f" from {', '.join(sources)}" if sources else ""))
            else:
                flags.append("loaded")
            count = self.row_count(table)
            columns = [column["name"] for column in self.table_columns(table)]
            shown = ", ".join(columns[:12]) + (f", +{len(columns) - 12} more" if len(columns) > 12 else "")
            flags.append((f"{count:,} rows" if count is not None else "rows unknown") + f": {shown}")
            charts = self.charts_of(table)
            if charts:
                flags.append(f"{len(charts)} chart{'s' if len(charts) != 1 else ''}")
            if self.reports_using(table):
                flags.append("used by a report")
            if self.apps_reading(name):
                flags.append("read by an app")
            mark = " [on canvas]" if path == f"session/tables/{name}.json" else ""
            tables.append((f"session/tables/{name}.json", f" \"{table.get('displayId') or name}\" — {' · '.join(flags)}{mark}",
                           [table, self._data_hash(name)]))
        section("Tables", tables, "session/tables")

        charts = []
        for chart in self.charts:
            if self.chart_spec(chart) is None:
                continue
            table = self.table_by_id[chart["tableRef"]]
            flags = [str(chart.get("chartType")), f"of {self.table_name(table)}"]
            if self.reports_showing(chart["id"]):
                flags.append("in a report")
            blocked = self._blocked().get(chart["tableRef"])
            if blocked:
                flags.append(f"cannot replace: {blocked}")
            chart_path = f"session/charts/{chart['id']}.json"
            mark = " [on canvas]" if path == chart_path else ""
            charts.append((chart_path, f" \"{self.chart_name(chart)}\" — {', '.join(flags)}{mark}",
                           [chart, (self.overlay.get(chart_path) or {}).get("content")]))
        charts += [(chart_path, f" \"{view.get('name')}\" — made in this run", view.get("content"))
                   for chart_path, view in self.overlay.items() if view.get("made_in_run")]
        section("Charts", charts, "session/charts")

        section("Reports", [(f"session/reports/{report['id']}.md", f" \"{self.report_name(report)}\""
                             + (" [on canvas]" if path == f"session/reports/{report['id']}.md" else ""),
                             [report, (self.overlay.get(f"session/reports/{report['id']}.md") or {}).get("content")])
                            for report in self.reports], "session/reports")
        section("Connected-source references", [
            (f"session/references/{reference['id']}.json",
             f" \"{reference.get('displayName') or reference['id']}\" — "
             f"{reference.get('connectorName') or reference.get('connectorId')}: {reference.get('tableKey')}"
             + (" [on canvas]" if path == f"session/references/{reference['id']}.json" else ""), reference)
            for reference in self.references], "session/references")

        try:
            from data_formulator.data_connector import list_available_connector_ids
            connected = list_available_connector_ids()
        except Exception:
            connected = []
        if connected:
            # Sources the user connected, beyond this session: searchable for more data.
            lines.extend([f"## Connected data sources ({len(connected)})",
                          "Catalogs under sources/ (search covers them; list_files sources/ to browse): " + ", ".join(connected[:12])
                          + (f" (+{len(connected) - 12} more)" if len(connected) > 12 else ""), ""])
        if self.workspace is not None:
            try:
                files = sorted(self.workspace.list_workspace_files(), key=lambda item: item.name.lower())
            except Exception:
                files = []
            folders: dict[str, list[Any]] = {}
            entries = []
            for item in files:
                if "/" in item.name:
                    folders.setdefault(item.name.split("/")[0], []).append([item.name, item.content_hash])
                    continue
                flags = ["app"] if item.name.lower().endswith((".app.jsx", ".html")) else []
                file_path = f"files/{item.name}"
                entries.append((file_path, (f" \"{item.display_name}\"" if item.display_name else "")
                                + (f" — {', '.join(flags)}" if flags else "") + (" [on canvas]" if path == file_path else ""),
                                item.content_hash))
            entries += [(f"files/{folder}/", f" ({len(members)} file{'s' if len(members) != 1 else ''})", members)
                        for folder, members in sorted(folders.items())]
            section("Workspace files", entries, "files/")
            scratch = self.workspace.list_scratch_files()
            if scratch:
                lines.append(f"## Scratch files ({len(scratch)})")
                lines.extend(f"- `{name}`" for name in scratch[:MAX_INDEX_LINES])
                if len(scratch) > MAX_INDEX_LINES:
                    lines.append(f"- … {len(scratch) - MAX_INDEX_LINES} more: list_files scratch/")
                lines.append("")
        if path:
            self.versions["@focus"] = path
        if len(lines) <= 3:
            lines.append("The session is empty.")
        return "\n".join(lines).rstrip() + "\n"

    def _node_state(self, node_id: str) -> Any:
        """What a thread node holds, for its thread's version."""
        for key in ("textTurns", "derivedTables", "inputTables", "loadedTableNodes", "fileNodes", "generatedReports", "artifactSets"):
            found = next((item for item in self.state[key] if item.get("id") == node_id), None)
            if found is not None:
                return found
        return node_id

    def _data_hash(self, name: str) -> str | None:
        try:
            return getattr(self.workspace.get_table_metadata(name), "content_hash", None) if self.workspace is not None else None
        except Exception:
            return None

    def changes(self, previous: dict[str, str], *, always_focus: bool = False) -> str:
        """``[SESSION CHANGES]`` since ``previous`` (versions from earlier index and changes messages)."""
        self.index()
        current = self.versions
        lines = []
        focus = current.get("@focus")
        if focus and focus != previous.get("@focus"):
            lines.append(self.focus_line().replace(" is on the canvas", " is now on the canvas", 1))
        elif always_focus and (focus_line := self.focus_line()):
            lines.append(focus_line)
        for path, tag in current.items():
            if path.startswith("@"):
                continue
            if path not in previous:
                lines.append(f"- added `{path}` #{tag}")
            elif previous[path] != tag:
                lines.append(f"- changed `{path}` #{tag}")
        lines += [f"- removed `{path}`" for path in previous if not path.startswith("@") and path not in current]
        if not lines:
            return "[SESSION CHANGES]\nNothing in the session changed since your last look."
        return ("[SESSION CHANGES]\nSince your last look at the session (only these changed; everything else is "
                "as you last saw it):\n" + "\n".join(lines))

    def _file_status(self, path: str) -> str:
        """For a file on the canvas: whether it still exists and whether the agent may edit it."""
        if self.workspace is None or not path.startswith(("files/", "scratch/")):
            return ""
        if path.startswith("scratch/"):
            return "" if path in self.workspace.list_scratch_files() else " (no longer exists)"
        item = self.workspace.get_metadata().files.get(path[len("files/"):])
        if item is None:
            return " (no longer exists)"
        return " (yours: edit it in place with edit_file)" if item.origin == "agent" and item.edit_policy == "agent_editable" \
            else " (the user's: copy it to change it)"

    # -- changes during the run ------------------------------------------------

    def record_edit(self, path: str, content: str) -> None:
        """An accepted edit: later reads of ``path`` see it."""
        base = self.view(path) or {}
        self.overlay[path] = {**base, "content": content}

    def add_run_chart(self, chart_id: str, spec: dict[str, Any], columns: list[str]) -> None:
        """A chart this run made, editable for the rest of the run."""
        self.overlay[f"session/charts/{chart_id}.json"] = {
            "content": _json(spec), "editable": True, "name": spec.get("title") or chart_id,
            "columns": columns, "made_in_run": True, "note": _chart_note(spec.get("table") or "", columns)}

    def forget(self, *, tables: set[str] = frozenset(), charts: set[str] = frozenset(),
               references: set[str] = frozenset()) -> None:
        """Deleted items leave the layer (``tables`` are node ids)."""
        state = self.state
        charts = {*charts, *(chart.get("id") for chart in state["charts"] if chart.get("tableRef") in tables)}
        state["inputTables"] = [table for table in state["inputTables"] if table.get("id") not in tables]
        state["derivedTables"] = [table for table in state["derivedTables"] if table.get("id") not in tables]
        state["charts"] = [chart for chart in state["charts"] if chart.get("id") not in charts]
        state["externalTableReferences"] = [ref for ref in state["externalTableReferences"] if ref.get("id") not in references]
        self.overlay = {path: view for path, view in self.overlay.items()
                        if not (path.startswith("session/charts/") and path[len("session/charts/"):-len(".json")] in charts)}
        self._rebuild()


def session_layer(payload: dict[str, Any] | None) -> SessionLayer | None:
    layer = (payload or {}).get("session_layer")
    return layer if isinstance(layer, SessionLayer) else None
