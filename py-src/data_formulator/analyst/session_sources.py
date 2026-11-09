"""Connected-source catalogs as read-only files under ``sources/`` (design-docs/66).

``sources/<source_id>/<catalog path…>``: one folder per connected source, then the catalog's own path
segments (a ``/`` inside a segment is written ``%2F``). A table's file is its metadata view: columns one
per line, so ``read_file`` offset/limit page them and ``search`` finds them; relationships; cached sample
rows; and the ``source_id`` / ``table_key`` that ``probe_data`` and ``propose_data_operation`` take.

Built from the per-user catalog cache. Listing, reading or searching a path under ``sources/`` first
applies each named source's refresh policy (as the discovery tools did); a search over everything reads
the cache only. Listings go one level at a time, like ``ls``: catalogs can hold thousands of tables.
"""

from __future__ import annotations

import fnmatch
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

ROOT = "sources/"
SEARCH_LINES_PER_TABLE = 3      # matching lines shown per catalog table
DEFAULT_SEARCH_TABLES = 10      # catalog tables shown when the search did not name sources/
VIEW_SAMPLE_ROWS = 5
PREVIEW_CHARS = 400             # the columns line of a catalog search hit
SOURCE_EXAMPLES = 8             # top-level names shown per source in the sources/ listing


def escape(segment: Any) -> str:
    return str(segment).replace("%", "%25").replace("/", "%2F")


def unescape(segment: str) -> str:
    return segment.replace("%2F", "/").replace("%25", "%")


@dataclass
class CatalogTable:
    source_id: str
    segments: list[str]
    node: dict[str, Any]

    @property
    def path(self) -> str:
        return ROOT + escape(self.source_id) + "/" + "/".join(escape(segment) for segment in self.segments)

    @property
    def metadata(self) -> dict[str, Any]:
        return self.node.get("metadata") or {}

    @property
    def table_key(self) -> str:
        return str(self.node.get("table_key") or "")

    @property
    def name(self) -> str:
        return str(self.node.get("name") or (self.segments[-1] if self.segments else self.table_key))


def _column_line(column: dict[str, Any]) -> str:
    from data_formulator.agents.context import _format_catalog_column
    return _format_catalog_column(column).strip().removeprefix("- ")


class Sources:
    """The ``sources/`` folder of one run (``workspace.user_home`` holds the catalog cache)."""

    def __init__(self, workspace: Any, layer: Any = None, *, enabled: bool = True):
        self.user_home = getattr(workspace, "user_home", None)
        self.layer = layer
        # Off on a demo, whose only data is its own datasets (design-docs/69).
        self.enabled = enabled
        self._catalogs: dict[str, list[CatalogTable]] = {}
        self._refreshed: set[str] = set()
        self._ids: list[str] | None = None
        self._bootstrapped = False

    @property
    def available(self) -> bool:
        return self.enabled and bool(self.user_home)

    # -- sources ---------------------------------------------------------------

    def bootstrap(self) -> None:
        """Cache the catalog of each usable source that has none yet (zero-config sources such as the
        sample datasets appear on first use); cached catalogs are read as they are."""
        if self._bootstrapped or not self.available:
            return
        self._bootstrapped = True
        try:
            from data_formulator.data_connector import _ADMIN_CONNECTOR_IDS, list_available_connector_ids
            from data_formulator.datalake.catalog_cache import list_cached_sources
            from data_formulator.datalake.catalog_refresh import ensure_catalog_freshness
            from data_formulator.datalake.connector_preferences import connector_is_enabled
            from data_formulator.data_operations.discovery import _source_is_discoverable
            cached = set(list_cached_sources(self.user_home))
            for source_id in sorted((set(_ADMIN_CONNECTOR_IDS) | set(list_available_connector_ids())) - cached):
                if connector_is_enabled(self.user_home, source_id) and _source_is_discoverable(source_id):
                    ensure_catalog_freshness(Path(self.user_home), source_id)
        except Exception:
            logger.debug("catalog bootstrap failed", exc_info=True)
        self._ids = None

    def source_ids(self, *, connected: bool = False) -> list[str]:
        """Cached, enabled and discoverable sources; with ``connected``, also connected sources not cached yet."""
        if not self.available:
            return []
        self.bootstrap()
        if self._ids is None:
            from data_formulator.data_operations.discovery import _source_is_discoverable
            from data_formulator.datalake.catalog_cache import list_cached_sources
            from data_formulator.datalake.connector_preferences import connector_is_enabled
            try:
                cached = list_cached_sources(self.user_home)
            except Exception:
                cached = []
            self._ids = sorted(source_id for source_id in cached
                               if connector_is_enabled(self.user_home, source_id) and _source_is_discoverable(source_id))
        ids = list(self._ids)
        if connected:
            try:
                from data_formulator.data_connector import list_available_connector_ids
                ids += sorted(set(list_available_connector_ids()) - set(ids))
            except Exception:
                pass
        return ids

    def display_name(self, source_id: str) -> str | None:
        try:
            from data_formulator.data_connector import _resolve_connector_with_key
            _, connector = _resolve_connector_with_key({"connector_id": source_id})
            name = getattr(connector, "_display_name", None)
            return name if name and name != source_id else None
        except Exception:
            return None

    def refresh(self, source_ids: list[str]) -> None:
        """Apply each source's refresh policy once per run, bootstrapping a connected source's first catalog."""
        from data_formulator.datalake.catalog_cache import list_cached_sources
        from data_formulator.datalake.catalog_refresh import ensure_catalog_freshness
        for source_id in source_ids:
            if source_id in self._refreshed or not self.available:
                continue
            self._refreshed.add(source_id)
            try:
                if source_id not in set(list_cached_sources(self.user_home)):
                    from data_formulator.data_connector import resolve_live_loader
                    resolve_live_loader(source_id)
                ensure_catalog_freshness(Path(self.user_home), source_id)
            except Exception:
                logger.debug("catalog refresh failed for %s", source_id, exc_info=True)
            self._catalogs.pop(source_id, None)
            self._ids = None

    def refresh_named(self, paths: list[str]) -> None:
        """Refresh the sources a set of paths names (``sources/`` alone names every source)."""
        named: list[str] = []
        for path in paths:
            parts = path.strip().lstrip("/").split("/")
            if parts[0] != ROOT[:-1]:
                continue
            if len(parts) < 2 or not parts[1] or any(char in parts[1] for char in "*?["):
                named += self.source_ids(connected=True)
            else:
                named.append(unescape(parts[1]))
        self.refresh(list(dict.fromkeys(named)))

    def catalog(self, source_id: str) -> list[CatalogTable]:
        if source_id not in self._catalogs:
            from data_formulator.datalake.catalog_cache import load_catalog
            try:
                nodes = load_catalog(Path(self.user_home), source_id) or []
            except Exception:
                nodes = []
            tables = []
            for node in nodes:
                segments = [str(segment) for segment in node.get("path") or []] or [str(node.get("name") or "")]
                if segments[-1]:
                    tables.append(CatalogTable(source_id, segments, node))
            self._catalogs[source_id] = tables
        return self._catalogs[source_id]

    def _parse(self, path: str) -> tuple[str, list[str]]:
        parts = [part for part in path[len(ROOT):].split("/")]
        if not parts or not parts[0]:
            return "", []
        return unescape(parts[0]), [unescape(part) for part in parts[1:] if part != ""]

    def table(self, path: str) -> CatalogTable | None:
        source_id, segments = self._parse(path)
        if source_id not in self.source_ids():
            return None
        return next((table for table in self.catalog(source_id) if table.segments == segments), None)

    # -- list ------------------------------------------------------------------

    def list(self, target: str) -> list[dict[str, Any]]:
        """One level under ``target`` (a folder path), or every table matching a glob."""
        self.refresh_named([target])
        if any(char in target for char in "*?["):
            return [self._table_item(table) for source_id in self.source_ids()
                    for table in self.catalog(source_id) if fnmatch.fnmatch(table.path, target)]
        table = self.table(target.rstrip("/"))
        if table is not None:
            return [self._table_item(table)]
        source_id, segments = self._parse(target)
        if not source_id:
            return [self._source_item(source_id) for source_id in self.source_ids(connected=True)]
        if source_id not in self.source_ids():
            return []
        folders: dict[str, int] = {}
        items: list[dict[str, Any]] = []
        depth = len(segments)
        for table in self.catalog(source_id):
            if table.segments[:depth] != segments or len(table.segments) <= depth:
                continue
            if len(table.segments) == depth + 1:
                items.append(self._table_item(table))
            else:
                folders[table.segments[depth]] = folders.get(table.segments[depth], 0) + 1
        prefix = ROOT + "/".join(escape(part) for part in [source_id, *segments]) + "/"
        return [{"path": prefix + escape(name) + "/", "kind": "folder",
                 "detail": f"{count:,} {'table' if count == 1 else 'tables'}"}
                for name, count in sorted(folders.items(), key=lambda item: item[0].lower())] + items

    def _source_item(self, source_id: str) -> dict[str, Any]:
        tables = self.catalog(source_id) if source_id in self.source_ids() else []
        name = self.display_name(source_id)
        examples: list[str] = []
        if tables:
            top = len({table.segments[0] for table in tables if len(table.segments) > 1})
            detail = (f"{len(tables):,} {'table' if len(tables) == 1 else 'tables'}"
                      + (f" in {top} top-level {'folder' if top == 1 else 'folders'}" if top else ""))
            names = list(dict.fromkeys(table.segments[0] + ("/" if len(table.segments) > 1 else "") for table in tables))
            examples = names[:SOURCE_EXAMPLES] + ([f"… {len(names) - SOURCE_EXAMPLES} more"]
                                                  if len(names) > SOURCE_EXAMPLES else [])
        else:
            detail = "connected; catalog not cached yet (listing it fetches the catalog)"
        return {"path": ROOT + escape(source_id) + "/", **({"name": name} if name else {}), "kind": "source",
                "detail": detail, **({"top_level": examples} if examples else {})}

    def _table_item(self, table: CatalogTable) -> dict[str, Any]:
        metadata = table.metadata
        parts = []
        columns = metadata.get("columns") or []
        if columns:
            parts.append(f"{len(columns)} {'field' if metadata.get('query_model') == 'semantic' else 'column'}"
                         f"{'' if len(columns) == 1 else 's'}")
        if metadata.get("row_count") is not None:
            try:
                parts.append(f"{int(metadata['row_count']):,} rows")
            except (TypeError, ValueError):
                pass
        if metadata.get("query_model") == "semantic":
            parts.append("semantic model")
        item: dict[str, Any] = {"path": table.path, "kind": "source table"}
        if table.name != table.segments[-1]:
            item["name"] = table.name
        if parts:
            item["detail"] = " · ".join(parts)
        return item

    # -- read ------------------------------------------------------------------

    def view(self, path: str) -> str:
        """A table's metadata view; raises ``FileNotFoundError``, or ``ValueError`` for a folder."""
        self.refresh_named([path])
        table = self.table(path)
        if table is None:
            source_id, segments = self._parse(path)
            if source_id in self.source_ids() and any(
                    candidate.segments[:len(segments)] == segments for candidate in self.catalog(source_id)):
                raise ValueError(f"{path} is a folder; list it with list_files.")
            raise FileNotFoundError(path)
        return self._render(table)

    def _render(self, table: CatalogTable) -> str:
        from data_formulator.data_connector import get_query_capabilities
        metadata = dict(table.metadata)
        status = metadata.get("source_metadata_status", "not_synced")
        if not metadata.get("columns"):
            # Columns never synced (a cluster-wide browse skips per-table schemas): fetch them live, uncached.
            try:
                from data_formulator.agents.context import _fetch_live_metadata
                live = _fetch_live_metadata(table.source_id, table.segments)
            except Exception:
                live = None
            if live and live.get("columns"):
                metadata.update(live)
                status = "live (fetched from the source; not cached)"
        source_name = self.display_name(table.source_id)
        lines = [f"# {table.name}",
                 f"Table in {source_name + ' (' + table.source_id + ')' if source_name else table.source_id}"
                 f" at {' > '.join(table.segments)}",
                 f"source_id: {table.source_id}",
                 f"table_key: {table.table_key}",
                 f"metadata: {status}"]
        for field in ("schema", "database", "row_count"):
            if metadata.get(field) is not None:
                lines.append(f"{field}: {metadata[field]}")
        for line in self._in_session(table):
            lines.append(line)
        description = metadata.get("description") or metadata.get("source_description") or ""
        if description:
            lines += ["", "Description: " + " ".join(str(description).split())]
        inspection = metadata.get("inspection") or {}
        details = {key: inspection[key] for key in (
            "schema_source", "schema_complete", "row_count_status", "sample_status", "sample_method", "filtered",
            "row_limit", "columns_omitted", "values_truncated") if key in inspection}
        if details:
            lines.append("Inspection: " + json.dumps(details, ensure_ascii=False, default=str))
        if inspection.get("schema_source") == "inferred":
            lines.append("Schema inferred from a bounded sample; later records may differ.")
        if inspection.get("row_count_status") == "unknown":
            lines.append("Row count not collected.")

        columns = metadata.get("columns") or []
        if metadata.get("query_model") == "semantic":
            roles = [column.get("role") for column in columns]
            lines += ["", f"Semantic model: {roles.count('measure')} measures, {roles.count('dimension')} dimensions, "
                          f"{roles.count('time_dimension')} time dimensions. Select dimensions and measures in "
                          "probe_data query.columns; the model groups by the selected dimensions."]
        lines += ["", f"Columns ({len(columns)}):" if columns else "Columns: not available in the catalog."]
        lines += [f"- {_column_line(column)}" for column in columns]
        relationships = metadata.get("relationships") or []
        if relationships:
            lines += ["", f"Relationships ({len(relationships)}):"]
            lines += ["- " + json.dumps(relationship, ensure_ascii=False, default=str) for relationship in relationships]
        sample = metadata.get("sample_rows")
        if sample:
            lines += ["", "Sample rows (cached; not necessarily representative):"]
            lines += [json.dumps(row, ensure_ascii=False, default=str)[:400] for row in sample[:VIEW_SAMPLE_ROWS]]
        capabilities = get_query_capabilities(table.source_id)
        lines += ["", "To query it: probe_data with this source_id and table_key for values or coverage; "
                      "propose_data_operation to load it into the session.",
                  "query_capabilities: " + json.dumps(capabilities, ensure_ascii=False, default=str)]
        return "\n".join(lines) + "\n"

    def _in_session(self, table: CatalogTable) -> list[str]:
        layer = self.layer
        if layer is None:
            return []
        found = []
        for reference in getattr(layer, "references", []) or []:
            if reference.get("connectorId") == table.source_id and reference.get("tableKey") == table.table_key:
                found.append(f"In this session: session/references/{reference['id']}.json (cached reference)")
        return found

    # -- search ----------------------------------------------------------------

    def search_sections(self, matcher: Any, scopes: list[str], max_results: int) -> tuple[list[Any], int]:
        """Catalog tables whose name, description or columns match: (sections, tables not shown)."""
        from data_formulator.analyst.session_fs import Section, _selected
        named = [scope for scope in scopes if isinstance(scope, str) and scope.strip().lstrip("/").startswith(ROOT[:-1])]
        if named:
            self.refresh_named(named)
        found = []
        for source_id in self.source_ids():
            for table in self.catalog(source_id):
                if named and not _selected(table.path, named):
                    continue
                section = self._section(table, matcher, Section)
                if section is not None:
                    found.append(section)
        found.sort(key=lambda section: section.order)
        cap = max_results if named else DEFAULT_SEARCH_TABLES
        return found[:cap], max(len(found) - cap, 0)

    def _section(self, table: CatalogTable, matcher: Any, section_class: Any) -> Any:
        metadata = table.metadata
        matched_in: list[str] = []
        name_hit = matcher.matches(table.name) or matcher.matches(" ".join(table.segments))
        if name_hit:
            matched_in.append("name")
        lines: list[tuple[str, str]] = []
        description = " ".join(str(metadata.get("description") or metadata.get("source_description") or "").split())
        if description and matcher.matches(description):
            matched_in.append("description")
            lines.append(("description", description))
        column_hits = [column for column in metadata.get("columns") or [] if matcher.matches(_column_line(column))]
        if column_hits:
            matched_in.append(f"{len(column_hits)} {'column' if len(column_hits) == 1 else 'columns'}")
            lines += [("column", _column_line(column)) for column in column_hits]
        if not matched_in:
            return None
        source_name = self.display_name(table.source_id)
        detail = self._table_item(table).get("detail")
        header = (f"## {table.path}" + (f' "{table.name}"' if table.name != table.segments[-1] else "")
                  + f" — table in {source_name or table.source_id}" + (f", {detail}" if detail else ""))
        # Matched in already counts every hit; a few lines are shown, the rest is one read_file away.
        shown = lines[:SEARCH_LINES_PER_TABLE]
        # What the next step needs without reading the table: its identity and columns.
        columns = metadata.get("columns") or []
        preview = f"source_id {table.source_id} · table_key {table.table_key}"
        if columns:
            names = ", ".join(f"{column.get('name')} {column.get('type') or column.get('role') or ''}".strip()
                              for column in columns)
            preview += f" · columns: {names[:PREVIEW_CHARS]}" + ("…" if len(names) > PREVIEW_CHARS else "")
        return section_class(table.path, header, (7, 0 if name_hit else 1, len(lines)), count=len(shown),
                             matched_in=matched_in, lines=shown, note=preview)
