from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING
import pandas as pd
import pyarrow as pa
import logging

from data_formulator.datalake.table_names import sanitize_external_loader_table_name

if TYPE_CHECKING:
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.datalake.workspace_metadata import TableMetadata

logger = logging.getLogger(__name__)


class ConnectorParamError(ValueError):
    """Raised when required connector parameters are missing or empty."""

    def __init__(self, missing: list[str], loader_name: str = ""):
        self.missing = missing
        self.loader_name = loader_name
        names = ", ".join(missing)
        super().__init__(f"Missing required parameter(s): {names}")


def _merge_source_metadata(
    table_metadata: "TableMetadata",
    source_meta: dict[str, Any],
) -> None:
    """Merge source-system metadata into a persisted ``TableMetadata``.

    Updates the object **in place**:

    * ``table_metadata.description`` ← ``source_meta["description"]`` if present.
    * Each column's ``description`` ← matching column entry in
      ``source_meta["columns"]`` if present.
    """
    if "description" in source_meta:
        table_metadata.description = source_meta["description"] or None

    src_cols = {c["name"]: c for c in source_meta.get("columns", [])}
    if not src_cols or not table_metadata.columns:
        return

    for col in table_metadata.columns:
        src = src_cols.get(col.name)
        if src and "description" in src:
            col.description = src["description"] or None

# Sensitive parameter names that should be excluded from stored metadata
SENSITIVE_PARAMS = {'password', 'api_key', 'secret', 'token', 'access_token', 'refresh_token', 'access_key', 'secret_key'}

# Valid operators for filter conditions (prevents SQL injection via operator field)
_VALID_OPERATORS = frozenset({
    '=', '!=', '<>', '>', '<', '>=', '<=',
    'LIKE', 'NOT LIKE', 'ILIKE', 'IN', 'NOT IN',
    'BETWEEN', 'IS NULL', 'IS NOT NULL',
})

_SOURCE_FILTER_OPERATOR_MAP = {
    "EQ": "=",
    "NEQ": "!=",
    "GT": ">",
    "GTE": ">=",
    "LT": "<",
    "LTE": "<=",
    "LIKE": "LIKE",
    "ILIKE": "ILIKE",
    "IN": "IN",
    "NOT_IN": "NOT IN",
    "IS_NULL": "IS NULL",
    "IS_NOT_NULL": "IS NOT NULL",
    "BETWEEN": "BETWEEN",
}

# Identifier-name validation: reject characters that could indicate SQL injection
# even after quote-doubling (semicolons, comment markers, null bytes).
import re
_DANGEROUS_IDENT_RE = re.compile(r'[;\x00]|--|/\*')


def _esc_id(name: str, quote_char: str) -> str:
    """Quote a SQL identifier, escaping embedded quote characters.

    E.g. ``_esc_id('col`name', '`')`` → `` `col``name` ``
    Rejects names with semicolons, null bytes, or SQL comment sequences.
    """
    if not name or _DANGEROUS_IDENT_RE.search(name):
        raise ValueError(f"Invalid identifier: {name!r}")
    escaped = name.replace(quote_char, quote_char * 2)
    return f"{quote_char}{escaped}{quote_char}"


def _esc_str(value: str) -> str:
    """Escape a string literal for SQL single-quote interpolation.

    Doubles single-quotes and strips null bytes.
    """
    return value.replace('\x00', '').replace("'", "''")


def build_where_clause(
    conditions: list[dict[str, Any]],
    quote_char: str = '`',
) -> tuple[str, list[Any]]:
    """Build a WHERE clause from structured filter conditions.

    Each condition is a dict with:
        - column (str): column name
        - operator (str): one of _VALID_OPERATORS
        - value: single value, list (IN/NOT IN), or [lo, hi] (BETWEEN)

    Returns (clause_str, params) where clause_str is like
    "WHERE `col1` > ? AND `col2` IN (?, ?)" and params is the flat list of
    bind values.  Returns ("", []) if conditions is empty.

    The caller is responsible for using parameterized execution with the
    returned params list.  For loaders that use string interpolation (e.g.
    ADBC), use :func:`build_where_clause_inline` instead.
    """
    if not conditions:
        return "", []

    parts: list[str] = []
    params: list[Any] = []
    for cond in conditions:
        col = cond.get("column", "")
        op = (cond.get("operator") or "").upper().strip()
        val = cond.get("value")

        if not col or op not in _VALID_OPERATORS:
            continue

        try:
            qcol = _esc_id(col, quote_char)
        except ValueError:
            continue

        if op in ("IS NULL", "IS NOT NULL"):
            parts.append(f"{qcol} {op}")
        elif op in ("IN", "NOT IN"):
            vals = val if isinstance(val, (list, tuple)) else [val]
            placeholders = ", ".join("?" for _ in vals)
            parts.append(f"{qcol} {op} ({placeholders})")
            params.extend(vals)
        elif op == "BETWEEN":
            if isinstance(val, (list, tuple)) and len(val) == 2:
                parts.append(f"{qcol} BETWEEN ? AND ?")
                params.extend(val)
        else:
            parts.append(f"{qcol} {op} ?")
            params.append(val)

    if not parts:
        return "", []
    return "WHERE " + " AND ".join(parts), params


def build_where_clause_inline(
    conditions: list[dict[str, Any]],
    quote_char: str = '`',
) -> str:
    """Build a WHERE clause with values inlined (for ADBC drivers that don't
    support parameterized queries).

    Values are escaped: strings are single-quoted with internal quotes doubled;
    numbers are passed as-is; None becomes NULL.
    """
    if not conditions:
        return ""

    def _lit(v: Any) -> str:
        if v is None:
            return "NULL"
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, (int, float)):
            return str(v)
        s = str(v).replace('\x00', '').replace("'", "''")
        return f"'{s}'"

    def _contains_lit(v: Any) -> str:
        s = str(v).replace('\x00', '').replace("'", "''")
        return f"'%{s}%'"

    parts: list[str] = []
    for cond in conditions:
        col = cond.get("column", "")
        op = (cond.get("operator") or "").upper().strip()
        val = cond.get("value")

        if not col or op not in _VALID_OPERATORS:
            continue

        try:
            qcol = _esc_id(col, quote_char)
        except ValueError:
            continue

        if op in ("IS NULL", "IS NOT NULL"):
            parts.append(f"{qcol} {op}")
        elif op in ("IN", "NOT IN"):
            vals = val if isinstance(val, (list, tuple)) else [val]
            parts.append(f"{qcol} {op} ({', '.join(_lit(v) for v in vals)})")
        elif op == "BETWEEN":
            if isinstance(val, (list, tuple)) and len(val) == 2:
                parts.append(f"{qcol} BETWEEN {_lit(val[0])} AND {_lit(val[1])}")
        else:
            parts.append(f"{qcol} {op} {_lit(val)}")

    if not parts:
        return ""
    return "WHERE " + " AND ".join(parts)


def build_source_filter_where_clause_inline(
    source_filters: list[dict[str, Any]] | None,
    quote_char: str = '`',
    dialect: str = "ansi",
) -> str:
    """Build a SQL WHERE clause from frontend ``source_filters``.

    ``source_filters`` use a source-agnostic operator vocabulary (``EQ``,
    ``NEQ``, ``GTE``, ``ILIKE``, ...). SQL loaders should compile that contract
    to their own dialect here instead of making the frontend emit dialect SQL.
    """
    if not source_filters:
        return ""

    def _lit(v: Any) -> str:
        if v is None:
            return "NULL"
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, (int, float)):
            return str(v)
        s = str(v).replace('\x00', '').replace("'", "''")
        return f"'{s}'"

    def _contains_lit(v: Any) -> str:
        s = str(v).replace('\x00', '').replace("'", "''")
        return f"'%{s}%'"

    parts: list[str] = []
    for sf in source_filters:
        if not isinstance(sf, dict):
            continue
        col = sf.get("column", "")
        source_op = (sf.get("operator") or "").upper().strip()
        op = _SOURCE_FILTER_OPERATOR_MAP.get(source_op)
        val = sf.get("value")

        if not col or not op:
            continue

        try:
            qcol = _esc_id(col, quote_char)
        except ValueError:
            continue

        if op in ("IS NULL", "IS NOT NULL"):
            parts.append(f"{qcol} {op}")
        elif op in ("IN", "NOT IN"):
            vals = val if isinstance(val, (list, tuple)) else [val]
            if not vals:
                continue
            parts.append(f"{qcol} {op} ({', '.join(_lit(v) for v in vals)})")
        elif op == "BETWEEN":
            if isinstance(val, (list, tuple)) and len(val) == 2:
                parts.append(f"{qcol} BETWEEN {_lit(val[0])} AND {_lit(val[1])}")
        elif op == "ILIKE" and dialect.lower() == "mysql":
            parts.append(f"LOWER({qcol}) LIKE LOWER({_contains_lit(val)})")
        elif op == "ILIKE":
            parts.append(f"{qcol} ILIKE {_contains_lit(val)}")
        else:
            parts.append(f"{qcol} {op} {_lit(val)}")

    if not parts:
        return ""
    return "WHERE " + " AND ".join(parts)


def sanitize_table_name(name_as: str) -> str:
    """Backward-compatible alias; see :func:`sanitize_external_loader_table_name`."""
    return sanitize_external_loader_table_name(name_as)


# ---------------------------------------------------------------------------
# Catalog tree model
# ---------------------------------------------------------------------------

SOURCE_METADATA_OK = "ok"
SOURCE_METADATA_PARTIAL = "partial"
SOURCE_METADATA_UNAVAILABLE = "unavailable"

# Sync-aware status values (set explicitly by sync_catalog_metadata)
SOURCE_METADATA_SYNCED = "synced"
SOURCE_METADATA_NOT_SYNCED = "not_synced"


def infer_source_metadata_status(metadata: dict[str, Any] | None) -> str:
    """Infer ``source_metadata_status`` from a catalog node's metadata dict.

    Returns ``"synced"`` when column metadata is present, ``"partial"``
    when only table-level metadata is available or the column list is known
    to be empty, and ``"unavailable"`` otherwise. Loaders may override the
    status by setting ``source_metadata_status`` explicitly.
    """
    if not metadata:
        return SOURCE_METADATA_UNAVAILABLE
    if "source_metadata_status" in metadata:
        return metadata["source_metadata_status"]
    has_table_desc = bool(metadata.get("description"))
    if "columns" in metadata:
        columns = metadata.get("columns") or []
        if columns:
            return SOURCE_METADATA_SYNCED
        return SOURCE_METADATA_PARTIAL
    if has_table_desc:
        return SOURCE_METADATA_PARTIAL
    return SOURCE_METADATA_UNAVAILABLE


@dataclass
class CatalogNode:
    """A node in the data source's catalog tree.

    Three kinds of node:

    * ``"namespace"`` — expandable container (database, schema, bucket, …).
      The hierarchy's ``label`` tells the UI what to call it.
    * ``"table"`` — importable leaf (table, file, dataset, …).
    * ``"table_group"`` — a loadable bundle of related tables with optional
      shared filters (e.g. a BI dashboard).  Rendered as a non-expandable
      leaf in the tree; member tables are listed in ``metadata["tables"]``.

    The *level name* (e.g. "Database", "Schema") comes from
    :meth:`ExternalDataLoader.catalog_hierarchy`, not from the node itself.
    """

    name: str                        # Display name ("public", "users", …)
    node_type: str                   # "namespace" or "table"
    path: list[str]                  # Full path from root: ["mydb", "public", "users"]
    metadata: dict[str, Any] | None = field(default=None)  # row_count, columns, …


class ExternalDataLoader(ABC):
    """
    Abstract base class for external data loaders.
    
    Data loaders fetch data from external sources (databases, cloud storage, etc.)
    and store data as parquet files in the workspace. DuckDB is not used for storage;
    it is only the computation engine elsewhere in the application.
    
    Ingest flow: External Source → PyArrow Table → Parquet (workspace).
    
    - `fetch_data_as_arrow()`: each loader must implement; fetches data as PyArrow Table.
    - `ingest_to_workspace()`: fetches via Arrow and writes parquet to the given workspace.
    """
    
    def get_safe_params(self) -> dict[str, Any]:
        """
        Get connection parameters with sensitive values removed.
        
        Uses the ``sensitive`` flag from :meth:`list_params` as the primary
        source of truth, falling back to the ``SENSITIVE_PARAMS`` name set
        for params not declared in ``list_params``.
        
        Returns:
            Dictionary of parameters safe to store in metadata
        """
        if not hasattr(self, 'params'):
            return {}
        
        # Build set of sensitive names from list_params declarations
        declared_sensitive = {
            p["name"] for p in self.list_params()
            if p.get("sensitive") or p.get("type") == "password"
        }
        
        return {
            k: v for k, v in self.params.items()
            if k not in declared_sensitive and k.lower() not in SENSITIVE_PARAMS
        }
    
    @abstractmethod
    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from the external source as a PyArrow Table.
        
        This is the primary method for data fetching. Each loader must implement
        this method to fetch data directly as Arrow format for optimal performance.
        Only source_table is supported (no raw query strings) to avoid security
        and dialect diversity issues across loaders.
        
        Args:
            source_table: Full table name (or table identifier) to fetch from
            import_options: Optional dict controlling what/how data is fetched:
                - size (int): Maximum number of rows to fetch (default: 1000000)
                - columns (list[str]): Column selection / projection
                - sort_columns (list[str]): Columns to sort by before limiting
                - sort_order (str): 'asc' or 'desc'
                - filters (list[dict]): Standard SPJ filters
                - source_filters (dict): Source-defined filters (BI tools)
            
        Returns:
            PyArrow Table with the fetched data
            
        Raises:
            ValueError: If source_table is not provided
        """
        pass
    
    def fetch_data_as_dataframe(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pd.DataFrame:
        """
        Fetch data from the external source as a pandas DataFrame.
        
        This method converts the Arrow table to pandas. For better performance,
        prefer using `fetch_data_as_arrow()` directly when possible.
        """
        arrow_table = self.fetch_data_as_arrow(
            source_table=source_table,
            import_options=import_options,
        )
        return arrow_table.to_pandas()
    
    def ingest_to_workspace(
        self,
        workspace: "Workspace",
        table_name: str,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> "TableMetadata":
        """
        Fetch data from external source and store as parquet in workspace.
        
        Uses PyArrow for efficient data transfer: External Source → Arrow → Parquet.
        This avoids pandas conversion overhead entirely.
        
        After writing the parquet file, performs a best-effort metadata
        enrichment: pulls table/column descriptions from the source system
        via ``get_column_types()`` and merges them into the persisted
        ``TableMetadata``.  Metadata failures never block the import.
        
        Args:
            workspace: The workspace to store data in
            table_name: Name for the table in the workspace
            source_table: Full table name to fetch from
            import_options: See fetch_data_as_arrow for details.
            
        Returns:
            TableMetadata for the created parquet file
        """
        arrow_table = self.fetch_data_as_arrow(
            source_table=source_table,
            import_options=import_options,
        )

        source_info = {
            "loader_type": self.__class__.__name__,
            "loader_params": self.get_safe_params(),
            "source_table": source_table,
            "import_options": import_options,
        }

        table_metadata = workspace.write_parquet_from_arrow(
            table=arrow_table,
            table_name=table_name,
            source_info=source_info,
        )

        # Best-effort metadata enrichment from the source system.
        try:
            source_meta = self.get_column_types(source_table)
            if source_meta:
                _merge_source_metadata(table_metadata, source_meta)
                workspace.add_table_metadata(table_metadata)
        except Exception as e:
            logger.debug(
                "Metadata enrichment skipped for %s: %s",
                table_name, type(e).__name__,
            )

        logger.info(
            "Ingested %d rows from %s to workspace as %s.parquet",
            arrow_table.num_rows, self.__class__.__name__, table_name,
        )

        return table_metadata

    @staticmethod
    @abstractmethod
    def list_params() -> list[dict[str, Any]]:
        """Return list of parameters needed to configure this data loader."""
        pass

    @classmethod
    def validate_params(
        cls,
        params: dict[str, Any],
        *,
        skip_auth_tier: bool = False,
    ) -> None:
        """Validate params against ``list_params()`` declarations.

        Raises ``ConnectorParamError`` listing all missing required parameters.
        When *skip_auth_tier* is True, parameters with ``tier="auth"`` are
        not checked (useful for SSO/token flows where auth comes externally).
        """
        missing: list[str] = []
        for pdef in cls.list_params():
            name = pdef.get("name", "")
            if not pdef.get("required"):
                continue
            if skip_auth_tier and pdef.get("tier") == "auth":
                continue
            val = params.get(name)
            if val is None or (isinstance(val, str) and not val.strip()):
                missing.append(name)
        if missing:
            raise ConnectorParamError(missing, cls.__name__)

    @staticmethod
    @abstractmethod
    def auth_instructions() -> str:
        """Return human-readable authentication instructions."""
        pass

    @staticmethod
    def delegated_login_config() -> dict[str, Any] | None:
        """Return config for delegated (popup-based) token login, or None.

        When a loader supports logging in via the external system's own
        login page (e.g. Superset's token bridge), return a dict with:

        * ``"login_url"`` — URL to open in a popup.
        * ``"label"`` — button label shown in the UI (e.g. "Login via Superset").

        The popup is expected to post a ``df-sso-auth`` message back via
        ``postMessage`` containing ``access_token``, ``refresh_token``,
        and ``user``.

        Returns ``None`` by default (not supported).
        """
        return None

    @abstractmethod
    def __init__(self, params: dict[str, Any]):
        """
        Initialize the data loader.

        Args:
            params: Configuration parameters for the loader (e.g. host, credentials).
        """
        pass

    @abstractmethod
    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List all accessible tables within the current pinned scope.

        This is the **flat / eager** complement to :meth:`ls`:

        * ``list_tables()`` returns *every* importable table the user can
          reach given the connection params (pinned scope).  Simple and
          complete, but potentially slow for large catalogs.
        * ``ls(path)`` returns one level of the hierarchy at a time
          (lazy).  Better UX for large catalogs, but requires the loader
          to implement hierarchical browsing.

        Both methods coexist permanently — ``list_tables`` is not legacy.
        The default ``ls()`` falls back to ``list_tables()`` for loaders
        that haven't implemented hierarchical browsing yet.

        Returns:
            List of dicts, each with:

            * ``name`` — the table identifier used for import
              (e.g. ``"public.users"``).
            * ``metadata`` — dict with ``row_count``, ``columns``,
              ``sample_rows``.
            * ``path`` *(optional)* — explicit hierarchy path as a list
              of segments (e.g. ``["public", "users"]``).  When present,
              :meth:`list_tables_tree` uses it directly to build the
              tree instead of splitting ``name`` on dots.
        """
        pass

    # ------------------------------------------------------------------ #
    # Catalog tree API                                                    #
    # ------------------------------------------------------------------ #
    #                                                                      #
    # Every data source has a natural hierarchy whose leaf nodes are        #
    # importable tables (or files / datasets).  ``catalog_hierarchy()``    #
    # declares the *full* hierarchy; ``ls(path)`` lazily lists one level.  #
    #                                                                      #
    # ``list_tables()`` is the flat/eager alternative — it returns every   #
    # table in the pinned scope in one shot.  Both coexist permanently.    #
    #                                                                      #
    # **Scope pinning** — when a connection param matches a hierarchy      #
    # level key (e.g. the user provides ``database="analytics"``), that    #
    # level is *pinned* and hidden from browsing.  The helper              #
    # ``effective_hierarchy()`` computes the browsable levels.             #
    # ------------------------------------------------------------------ #

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        """Declare the *full* hierarchy of this data source.

        Returns an ordered list from root to leaf.  Each entry:

        * ``"key"``  — internal identifier, matches a param name in
          ``list_params()`` when the level is pinnable (e.g. ``"database"``).
        * ``"label"`` — user-facing display name (e.g. ``"Database"``).

        The **last** entry is always the importable leaf (table / file /
        dataset).

        Examples::

            MySQL:      [{"key":"database","label":"Database"},
                         {"key":"table","label":"Table"}]
            PostgreSQL: [{"key":"database","label":"Database"},
                         {"key":"schema","label":"Schema"},
                         {"key":"table","label":"Table"}]
            BigQuery:   [{"key":"project","label":"Project"},
                         {"key":"dataset","label":"Dataset"},
                         {"key":"table","label":"Table"}]
            S3:         [{"key":"bucket","label":"Bucket"},
                         {"key":"object","label":"File"}]

        Default (flat): ``[{"key":"table","label":"Table"}]``.
        """
        return [{"key": "table", "label": "Table"}]

    def effective_hierarchy(self) -> list[dict[str, str]]:
        """Return the *browsable* hierarchy — full hierarchy minus pinned levels.

        A level is **pinned** when:

        1. Its ``key`` appears in the loader's ``list_params()`` with
           ``scope_level=True`` (or when ``key`` matches a param name), AND
        2. The user provided a non-empty value for that param at connect time.

        The pinned value is used transparently by ``ls()`` so the user never
        has to browse that level.

        Example — PostgreSQL with ``database="prod"`` provided::

            full:      database → schema → table
            effective: schema → table       (database is pinned to "prod")

        Example — PostgreSQL with *no* ``database`` provided::

            full:      database → schema → table
            effective: database → schema → table   (all levels browsable)
        """
        params = getattr(self, "params", {}) or {}
        full = self.catalog_hierarchy()
        return [
            level for level in full
            if not params.get(level["key"])  # empty / missing → browsable
        ]

    def pinned_scope(self) -> dict[str, str]:
        """Return ``{level_key: value}`` for every pinned hierarchy level.

        These are the levels that were fixed at connection time and are
        hidden from tree browsing.
        """
        params = getattr(self, "params", {}) or {}
        return {
            level["key"]: params[level["key"]]
            for level in self.catalog_hierarchy()
            if params.get(level["key"])
        }

    def ls(
        self,
        path: list[str] | None = None,
        filter: str | None = None,
    ) -> list[CatalogNode]:
        """List children at a catalog path (like ``ls`` in a filesystem).

        This is the **lazy / hierarchical** complement to :meth:`list_tables`.
        It returns one level of the catalog at a time, which is better for
        large catalogs but requires the loader to implement hierarchical
        browsing.

        ``path`` is relative to the **effective** (unpinned) hierarchy.

        * ``path=[]`` — list nodes at the first *browsable* level.
        * ``path=["public"]`` — expand that node one level deeper.
        * The length of ``path`` must be ``< len(effective_hierarchy())``.

        The default implementation falls back to :meth:`list_tables` at the
        root level.  Subclasses should override for true hierarchical
        browsing.

        Args:
            path: List of names, one per effective hierarchy level.
            filter: Optional substring filter on node names.

        Returns:
            :class:`CatalogNode` objects representing children.
        """
        if path:
            return []
        tables = self.list_tables(table_filter=filter)
        return [
            CatalogNode(
                name=t["name"],
                node_type="table",
                path=[t["name"]],
                metadata=t.get("metadata"),
            )
            for t in tables
        ]

    def get_column_values(
        self,
        source_table: str,
        column_name: str,
        keyword: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Return distinct values for a column (used for smart filter inputs).

        Subclasses may override to provide richer results (e.g. via native
        Superset APIs).  The default returns an empty list, signalling that
        the frontend should fall back to a free-text input.

        Returns ``{"options": [{"label": str, "value": ...}], "has_more": bool}``.
        """
        return {"options": [], "has_more": False}

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        """Get detailed metadata for a single catalog node.

        For a table: columns, types, row count, sample rows.
        Default: finds the node via ``ls`` and returns its metadata dict.
        """
        if not path:
            return {}
        nodes = self.ls(path[:-1], filter=path[-1])
        for n in nodes:
            if n.name == path[-1]:
                return n.metadata or {}
        return {}

    def get_column_types(self, source_table: str) -> dict[str, Any]:
        """Return source-level column type info for a table.

        Returns ``{"columns": [{"name": str, "type": str, "is_dttm": bool}, ...],
        "description": str | None}``.
        The ``type`` is the *original* source type (e.g. ``TIMESTAMP``,
        ``VARCHAR``, ``BOOLEAN``) — not pandas dtype — so the frontend can
        choose the correct filter widget.

        Default: tries ``get_metadata(path)`` where *path* is derived by
        splitting ``source_table`` on ``"."``.  SQL-based loaders that
        already implement ``get_metadata`` with ``information_schema``
        queries get this for free.
        """
        try:
            path = source_table.split(".")
            meta = self.get_metadata(path)
            if meta and "columns" in meta:
                result: dict[str, Any] = {"columns": meta["columns"]}
                if meta.get("description"):
                    result["description"] = meta["description"]
                return result
        except Exception:
            pass
        return {}

    def _tables_to_catalog_tree(self, tables: list[dict[str, Any]]) -> list[dict]:
        """Build a nested catalog tree from ``list_tables``-style entries."""
        eff = self.effective_hierarchy()
        num_ns = len(eff) - 1  # namespace levels before the leaf

        # Normalise each entry into a (path_segments, original_name, metadata) tuple.
        # If the path has more segments than the effective hierarchy depth,
        # strip leading segments (they correspond to pinned levels the
        # loader included).  If it matches or is shorter, use as-is.
        eff_depth = len(eff)  # expected number of segments (namespace levels + leaf)

        entries: list[tuple[list[str], str, dict | None]] = []
        for t in tables:
            orig_name: str = t["name"]
            meta = t.get("metadata")
            # Propagate table_key into metadata so the frontend can use it
            table_key = t.get("table_key")
            if table_key:
                meta = {**(meta or {}), "table_key": table_key}
            if "path" in t and isinstance(t["path"], list) and t["path"]:
                segments = list(t["path"])
                # Strip leading segments if path is longer than effective hierarchy
                if len(segments) > eff_depth:
                    segments = segments[len(segments) - eff_depth:]
            else:
                # Fallback: split dotted name to fill num_ns namespace levels + leaf
                segments = orig_name.split(".", maxsplit=num_ns) if num_ns > 0 else [orig_name]
            entries.append((segments, orig_name, meta))

        # Build tree by grouping on successive path segments.
        def _build(items: list[tuple[list[str], str, dict | None]], depth: int, prefix: list[str]) -> list[dict]:
            if depth >= num_ns:
                # Leaf level — use last segment as the table name
                result = []
                for segs, orig, meta in items:
                    merged = {**(meta or {}), "_source_name": orig}
                    if "source_metadata_status" not in merged:
                        merged["source_metadata_status"] = infer_source_metadata_status(meta)
                    result.append({
                        "name": segs[-1] if segs else orig,
                        "node_type": "table",
                        "path": prefix + [segs[-1] if segs else orig],
                        "metadata": merged,
                    })
                return result

            # Group by first path segment
            from collections import OrderedDict
            groups: OrderedDict[str, list[tuple[list[str], str, dict | None]]] = OrderedDict()
            ungrouped: list[tuple[list[str], str, dict | None]] = []

            for segs, orig, meta in items:
                if len(segs) > 1:
                    ns = segs[0]
                    rest = segs[1:]
                    groups.setdefault(ns, []).append((rest, orig, meta))
                else:
                    ungrouped.append((segs, orig, meta))

            nodes: list[dict] = []
            for ns, children in groups.items():
                ns_path = prefix + [ns]
                nodes.append({
                    "name": ns,
                    "node_type": "namespace",
                    "path": ns_path,
                    "metadata": None,
                    "children": _build(children, depth + 1, ns_path),
                })
            for segs, orig, meta in ungrouped:
                leaf_name = segs[0] if segs else orig
                merged = {**(meta or {}), "_source_name": orig}
                if "source_metadata_status" not in merged:
                    merged["source_metadata_status"] = infer_source_metadata_status(meta)
                nodes.append({
                    "name": leaf_name,
                    "node_type": "table",
                    "path": prefix + [leaf_name],
                    "metadata": merged,
                })
            return nodes

        tree = _build(entries, 0, [])
        return tree

    def list_tables_tree(self, table_filter: str | None = None) -> dict:
        """Build a nested tree from :meth:`list_tables` results.

        Returns ``{"hierarchy": [...], "effective_hierarchy": [...],
        "tree": [...]}``.  Each table entry keeps the full metadata
        (columns, sample_rows, row_count) from ``list_tables()`` plus
        ``_source_name`` (the original name used for import).

        If a table entry includes an explicit ``path`` list, it is used
        directly to place the table in the tree.  Otherwise the ``name``
        is split on ``"."`` as a fallback.
        """
        tree = self._tables_to_catalog_tree(self.list_tables(table_filter=table_filter))

        return {
            "hierarchy": self.catalog_hierarchy(),
            "effective_hierarchy": self.effective_hierarchy(),
            "tree": tree,
        }

    def search_catalog(self, query: str, limit: int = 100) -> dict:
        """Return lightweight catalog search results as a tree.

        The default implementation reuses ``list_tables(table_filter=...)`` for
        compatibility. Large or special loaders should override this to avoid
        fetching columns, samples, or counts for search-only results.
        """
        text = (query or "").strip()
        if not text:
            return {"tree": [], "truncated": False}

        max_results = max(1, int(limit or 100))
        tables = self.list_tables(table_filter=text)
        truncated = len(tables) > max_results
        return {
            "tree": self._tables_to_catalog_tree(tables[:max_results]),
            "truncated": truncated,
        }

    def sync_catalog_metadata(
        self, table_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """Full metadata sync for catalog cache.

        Default implementation: returns ``list_tables()`` results as-is.
        SQL-based loaders (PostgreSQL, MySQL, etc.) already include full
        column info from ``information_schema`` in ``list_tables()``, so the
        default is sufficient.

        Override this method only when ``list_tables()`` is intentionally
        lightweight and per-table detail requires additional API calls
        (e.g. Superset).

        Each returned table record **must** contain a ``table_key`` field —
        see :meth:`ensure_table_keys` for the contract.
        """
        tables = self.list_tables(table_filter)
        self.ensure_table_keys(tables)
        for t in tables:
            meta = t.get("metadata")
            if meta and "source_metadata_status" not in meta:
                meta["source_metadata_status"] = SOURCE_METADATA_SYNCED
        return tables

    @staticmethod
    def ensure_table_keys(tables: list[dict[str, Any]]) -> None:
        """Ensure every table record has a ``table_key`` field.

        If a record lacks ``table_key``, falls back to
        ``metadata["_source_name"]`` → ``name``.  Warns on records where
        an explicit key is missing so loader authors notice and fix it.
        """
        for t in tables:
            if t.get("table_key"):
                continue
            meta = t.get("metadata") or {}
            fallback = meta.get("_source_name") or t.get("name", "")
            if fallback:
                t["table_key"] = fallback
            else:
                logger.warning("Table record missing table_key and name: %s", t)

    def test_connection(self) -> bool:
        """Validate the connection is alive.

        Default: tries a lightweight ``list_tables`` call.
        Subclasses should override with something cheaper
        (e.g. ``SELECT 1``).
        """
        try:
            self.list_tables(table_filter="__ping__")
            return True
        except Exception:
            return False

    @staticmethod
    def auth_mode() -> str:
        """Return ``'connection'`` (default) or ``'token'``.

        Legacy interface kept for backward compatibility.
        New loaders should implement :meth:`auth_config` instead.
        """
        return "connection"

    @staticmethod
    def auth_config() -> dict:
        """Declare how this loader authenticates with its target system.

        The :class:`~data_formulator.auth.token_store.TokenStore` reads this
        to determine which credential strategies to attempt.

        Supported modes and required keys:

        ``mode="credentials"`` (default)
            Static username/password via Vault.

        ``mode="sso_exchange"``
            SSO token → target system token, backend-to-backend.
            Required: ``exchange_url``.
            Optional: ``token_url``, ``login_url`` (popup fallback), ``timeout``.

        ``mode="delegated"``
            Popup window → target system login → postMessage back.
            Required: ``login_url``.
            Optional: ``token_url``.

        ``mode="oauth2"``
            Independent OAuth2 flow (different IdP).
            Required: ``authorize_url``, ``token_url``.
            Optional: ``scopes``, ``client_id_env``, ``client_secret_env``.

        Common optional keys:
            ``display_name``: human-readable name.
            ``supports_refresh``: whether refresh_token is available.
        """
        return {"mode": "credentials"}

    @staticmethod
    def rate_limit() -> dict | None:
        """Optional rate-limit hints.  ``None`` = no limit."""
        return None
