import json
import logging
from typing import Any

import pandas as pd
import pyarrow as pa
import connectorx as cx

from data_formulator.data_loader.external_data_loader import ExternalDataLoader

logger = logging.getLogger(__name__)


class PostgreSQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "postgres", "description": "PostgreSQL username"}, 
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": "PostgreSQL host"}, 
            {"name": "port", "type": "string", "required": False, "default": "5432", "description": "PostgreSQL port"},
            {"name": "database", "type": "string", "required": True, "default": "postgres", "description": "PostgreSQL database name"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return "Provide your PostgreSQL connection details. The user must have SELECT permissions on the tables you want to access. Uses connectorx for fast Arrow-native data access."

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.host = self.params.get("host", "")
        self.port = self.params.get("port", "") or "5432"
        self.user = self.params.get("user", "")
        self.database = self.params.get("database", "")
        self.password = self.params.get("password", "")

        if not self.host:
            raise ValueError("PostgreSQL host is required")
        if not self.user:
            raise ValueError("PostgreSQL user is required")
        if not self.database:
            raise ValueError("PostgreSQL database is required")

        # Build connection URL for connectorx: postgresql://user:password@host:port/database
        # - Use explicit empty password (user:@host) so the URL parser sees user vs password correctly.
        # - Use 127.0.0.1 when host is localhost to force IPv4 TCP and avoid IPv6 ::1 connection issues.
        host_for_url = "127.0.0.1" if (self.host or "").strip().lower() == "localhost" else self.host
        if self.password:
            self.connection_url = f"postgresql://{self.user}:{self.password}@{host_for_url}:{self.port}/{self.database}"
        else:
            self.connection_url = f"postgresql://{self.user}:@{host_for_url}:{self.port}/{self.database}"

        try:
            cx.read_sql(self.connection_url, "SELECT 1", return_type="arrow")
        except Exception as e:
            logger.error(f"Failed to connect to PostgreSQL (postgresql://{self.user}:***@{self.host}:{self.port}/{self.database}): {e}")
            raise ValueError(f"Failed to connect to PostgreSQL database '{self.database}' on host '{self.host}': {e}") from e
        logger.info(f"Successfully connected to PostgreSQL: postgresql://{self.user}:***@{self.host}:{self.port}/{self.database}")

    def fetch_data_as_arrow(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pa.Table:
        """
        Fetch data from PostgreSQL as a PyArrow Table using connectorx.
        
        connectorx provides extremely fast Arrow-native database access,
        typically 2-10x faster than pandas-based approaches.
        """
        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Handle table names like "mypostgresdb.schema.table" -> "schema.table"
        table_ref = source_table
        if source_table.startswith("mypostgresdb."):
            table_ref = source_table[len("mypostgresdb."):]
        base_query = f"SELECT * FROM {table_ref}"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'"{col}" {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        # Build full query with limit
        query = f"{base_query}{order_by_clause} LIMIT {size}"
        
        logger.info(f"Executing PostgreSQL query via connectorx: {query[:200]}...")
        
        # Execute with connectorx - returns Arrow table directly
        arrow_table = cx.read_sql(self.connection_url, query, return_type="arrow")
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from PostgreSQL [Arrow-native]")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List available tables from PostgreSQL."""
        return self._list_tables_connectorx(table_filter)

    def _list_tables_connectorx(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables using connectorx."""
        try:
            # Query tables from information_schema
            query = """
                SELECT table_schema as schemaname, table_name as tablename 
                FROM information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
                AND table_schema NOT LIKE '%_intern%' 
                AND table_schema NOT LIKE '%timescaledb%'
                AND table_name NOT LIKE '%/%'
                AND table_type = 'BASE TABLE'
                ORDER BY table_schema, table_name
            """
            tables_arrow = cx.read_sql(self.connection_url, query, return_type="arrow")
            tables_df = tables_arrow.to_pandas()
            
            logger.info(f"Found {len(tables_df)} tables")
            
            results = []
            
            for _, row in tables_df.iterrows():
                schema = row['schemaname']
                table_name = row['tablename']
                full_table_name = f"{schema}.{table_name}"
                
                # Apply filter if provided
                if table_filter and table_filter.lower() not in full_table_name.lower():
                    continue
                
                try:
                    # Get column information
                    columns_query = f"""
                        SELECT column_name, data_type 
                        FROM information_schema.columns 
                        WHERE table_schema = '{schema}' AND table_name = '{table_name}'
                        ORDER BY ordinal_position
                    """
                    columns_arrow = cx.read_sql(self.connection_url, columns_query, return_type="arrow")
                    columns_df = columns_arrow.to_pandas()
                    columns = [{
                        'name': col_row['column_name'],
                        'type': col_row['data_type']
                    } for _, col_row in columns_df.iterrows()]
                    
                    # Get sample data
                    sample_query = f'SELECT * FROM "{schema}"."{table_name}" LIMIT 10'
                    sample_arrow = cx.read_sql(self.connection_url, sample_query, return_type="arrow")
                    sample_df = sample_arrow.to_pandas()
                    sample_rows = json.loads(sample_df.to_json(orient="records"))
                    
                    # Get row count
                    count_query = f'SELECT COUNT(*) as cnt FROM "{schema}"."{table_name}"'
                    count_arrow = cx.read_sql(self.connection_url, count_query, return_type="arrow")
                    row_count = count_arrow.to_pandas()['cnt'].iloc[0]
                    
                    table_metadata = {
                        "row_count": int(row_count),
                        "columns": columns,
                        "sample_rows": sample_rows
                    }
                    
                    results.append({
                        "name": full_table_name,
                        "metadata": table_metadata
                    })
                    
                except Exception as e:
                    logger.warning(f"Error processing table {full_table_name}: {e}")
                    continue
            
            return results

        except Exception as e:
            logger.error(f"Error listing tables: {e}")
            return []
