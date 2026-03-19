from abc import ABC, abstractmethod
from typing import Any, TYPE_CHECKING
import pandas as pd
import pyarrow as pa
import re
import logging

if TYPE_CHECKING:
    from data_formulator.datalake.workspace import Workspace
    from data_formulator.datalake.metadata import TableMetadata

logger = logging.getLogger(__name__)

# Sensitive parameter names that should be excluded from stored metadata
SENSITIVE_PARAMS = {'password', 'api_key', 'secret', 'token', 'access_key', 'secret_key'}


def sanitize_table_name(name_as: str) -> str:
    if not name_as:
        raise ValueError("Table name cannot be empty")
    
    # Remove any SQL injection attempts
    name_as = name_as.replace(";", "").replace("--", "").replace("/*", "").replace("*/", "")
    
    # Preserve Unicode letters and digits while normalizing separators.
    sanitized = re.sub(r"[^\w]+", "_", name_as, flags=re.UNICODE)
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        sanitized = "table"
    
    # Ensure the name starts with a letter or underscore
    if not sanitized[0].isalpha() and sanitized[0] != '_':
        sanitized = '_' + sanitized
    
    # Ensure the name is not a SQL keyword
    sql_keywords = {
        'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT',
        'OFFSET', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'ON',
        'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE', 'UNION', 'ALL', 'DISTINCT',
        'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'TABLE', 'VIEW', 'INDEX',
        'ALTER', 'ADD', 'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
        'CONSTRAINT', 'DEFAULT', 'CHECK', 'UNIQUE', 'CASCADE', 'RESTRICT'
    }
    
    if sanitized.upper() in sql_keywords:
        sanitized = '_' + sanitized
    
    # Ensure the name is not too long (common SQL limit is 63 characters)
    if len(sanitized) > 63:
        sanitized = sanitized[:63]
    
    return sanitized

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
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pa.Table:
        """
        Fetch data from the external source as a PyArrow Table.
        
        This is the primary method for data fetching. Each loader must implement
        this method to fetch data directly as Arrow format for optimal performance.
        Only source_table is supported (no raw query strings) to avoid security
        and dialect diversity issues across loaders.
        
        Args:
            source_table: Full table name (or table identifier) to fetch from
            size: Maximum number of rows to fetch
            sort_columns: Columns to sort by before limiting
            sort_order: Sort direction ('asc' or 'desc')
            
        Returns:
            PyArrow Table with the fetched data
            
        Raises:
            ValueError: If source_table is not provided
            NotImplementedError: If the loader doesn't support this method yet
        """
        pass
    
    def fetch_data_as_dataframe(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pd.DataFrame:
        """
        Fetch data from the external source as a pandas DataFrame.
        
        This method converts the Arrow table to pandas. For better performance,
        prefer using `fetch_data_as_arrow()` directly when possible.
        
        Args:
            source_table: Full table name to fetch from
            size: Maximum number of rows to fetch
            sort_columns: Columns to sort by before limiting
            sort_order: Sort direction ('asc' or 'desc')
            
        Returns:
            pandas DataFrame with the fetched data
        """
        arrow_table = self.fetch_data_as_arrow(
            source_table=source_table,
            size=size,
            sort_columns=sort_columns,
            sort_order=sort_order,
        )
        return arrow_table.to_pandas()
    
    def ingest_to_workspace(
        self,
        workspace: "Workspace",
        table_name: str,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> "TableMetadata":
        """
        Fetch data from external source and store as parquet in workspace.
        
        Uses PyArrow for efficient data transfer: External Source → Arrow → Parquet.
        This avoids pandas conversion overhead entirely.
        
        Args:
            workspace: The workspace to store data in
            table_name: Name for the table in the workspace
            source_table: Full table name to fetch from
            size: Maximum number of rows to fetch
            sort_columns: Columns to sort by before limiting
            sort_order: Sort direction ('asc' or 'desc')
            
        Returns:
            TableMetadata for the created parquet file
        """
        # Fetch data as Arrow table (efficient, no pandas conversion)
        arrow_table = self.fetch_data_as_arrow(
            source_table=source_table,
            size=size,
            sort_columns=sort_columns,
            sort_order=sort_order,
        )

        # Prepare loader metadata
        loader_metadata = {
            "loader_type": self.__class__.__name__,
            "loader_params": self.get_safe_params(),
            "source_table": source_table,
        }

        # Write Arrow table directly to parquet (no pandas conversion)
        table_metadata = workspace.write_parquet_from_arrow(
            table=arrow_table,
            table_name=table_name,
            loader_metadata=loader_metadata,
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
        """
        List available tables (or files) from the data source.

        Returns:
            List of dicts with: name (table/file identifier), metadata (row_count, columns, sample_rows).
        """
        pass
