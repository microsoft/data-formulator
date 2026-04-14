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

# Sensitive parameter names that should be excluded from stored metadata
SENSITIVE_PARAMS = {'password', 'api_key', 'secret', 'token', 'access_key', 'secret_key'}


def sanitize_table_name(name_as: str) -> str:
    """Backward-compatible alias; see :func:`sanitize_external_loader_table_name`."""
    return sanitize_external_loader_table_name(name_as)


# ---------------------------------------------------------------------------
# Catalog tree model
# ---------------------------------------------------------------------------

@dataclass
class CatalogNode:
    """A node in the data source's catalog tree.

    Only two kinds of node:

    * ``"namespace"`` — expandable container (database, schema, bucket, …).
      The hierarchy's ``label`` tells the UI what to call it.
    * ``"table"`` — importable leaf (table, file, dataset, …).

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
        
        Returns:
            Dictionary of parameters safe to store in metadata
        """
        if not hasattr(self, 'params'):
            return {}
        
        return {
            k: v for k, v in self.params.items()
            if k.lower() not in SENSITIVE_PARAMS
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
        
        Args:
            workspace: The workspace to store data in
            table_name: Name for the table in the workspace
            source_table: Full table name to fetch from
            import_options: See fetch_data_as_arrow for details.
            
        Returns:
            TableMetadata for the created parquet file
        """
        # Fetch data as Arrow table (efficient, no pandas conversion)
        arrow_table = self.fetch_data_as_arrow(
            source_table=source_table,
            import_options=import_options,
        )

        # Prepare loader metadata
        source_info = {
            "loader_type": self.__class__.__name__,
            "loader_params": self.get_safe_params(),
            "source_table": source_table,
            "import_options": import_options,
        }

        # Write Arrow table directly to parquet (no pandas conversion)
        table_metadata = workspace.write_parquet_from_arrow(
            table=arrow_table,
            table_name=table_name,
            source_info=source_info,
        )
        
        logger.info(
            f"Ingested {arrow_table.num_rows} rows from {self.__class__.__name__} "
            f"to workspace as {table_name}.parquet"
        )
        
        return table_metadata

    @staticmethod
    @abstractmethod
    def list_params() -> list[dict[str, Any]]:
        """Return list of parameters needed to configure this data loader."""
        pass

    @staticmethod
    @abstractmethod
    def auth_instructions() -> str:
        """Return human-readable authentication instructions."""
        pass

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
            List of dicts with: name (table/file identifier),
            metadata (row_count, columns, sample_rows).
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
        """Return ``'connection'`` (default) or ``'token'``."""
        return "connection"

    @staticmethod
    def rate_limit() -> dict | None:
        """Optional rate-limit hints.  ``None`` = no limit."""
        return None
