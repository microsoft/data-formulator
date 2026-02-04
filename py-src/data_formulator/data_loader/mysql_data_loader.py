import json
import logging
from typing import Any

import pandas as pd
import pyarrow as pa
import connectorx as cx

from data_formulator.data_loader.external_data_loader import ExternalDataLoader

logger = logging.getLogger(__name__)


class MySQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "root", "description": ""}, 
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": ""}, 
            {"name": "port", "type": "int", "required": False, "default": 3306, "description": "MySQL server port (default 3306)"},
            {"name": "database", "type": "string", "required": True, "default": "mysql", "description": ""}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
MySQL Connection Instructions:

1. Local MySQL Setup:
   - Ensure MySQL server is running on your machine
   - Default connection: host='localhost', user='root', port=3306
   - If you haven't set a root password, leave password field empty

2. Remote MySQL Connection:
   - Obtain host address, port, username, and password from your database administrator
   - Ensure the MySQL server allows remote connections
   - Check that your IP is whitelisted in MySQL's user permissions

3. Common Connection Parameters:
   - user: Your MySQL username (default: 'root')
   - password: Your MySQL password (leave empty if no password set)
   - host: MySQL server address (default: 'localhost')
   - port: MySQL server port (default: 3306)
   - database: Target database name to connect to

4. Troubleshooting:
   - Verify MySQL service is running: `brew services list` (macOS) or `sudo systemctl status mysql` (Linux)
   - Test connection: `mysql -u [username] -p -h [host] -P [port] [database]`
"""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.host = self.params.get("host", "")
        self.user = self.params.get("user", "")
        self.password = self.params.get("password", "")
        self.database = self.params.get("database", "")

        if not self.host:
            raise ValueError("MySQL host is required")
        if not self.user:
            raise ValueError("MySQL user is required")
        if not self.database:
            raise ValueError("MySQL database is required")

        port = self.params.get("port", "")
        if isinstance(port, str):
            self.port = int(port) if port else 3306
        elif not port:
            self.port = 3306
        else:
            self.port = int(port)
        
        # Build connection URL for connectorx
        # Format: mysql://user:password@host:port/database
        # - Use explicit empty password (user:@host) so the URL parser sees user vs password correctly.
        # - Use 127.0.0.1 when host is localhost to force IPv4 TCP and avoid IPv6 ::1 connection issues.
        host_for_url = "127.0.0.1" if (self.host or "").strip().lower() == "localhost" else self.host
        if self.password:
            self.connection_url = f"mysql://{self.user}:{self.password}@{host_for_url}:{self.port}/{self.database}"
        else:
            self.connection_url = f"mysql://{self.user}:@{host_for_url}:{self.port}/{self.database}"
        
        self._sanitized_url = f"mysql://{self.user}:***@{self.host}:{self.port}/{self.database}"
        
        # Test connection
        try:
            cx.read_sql(self.connection_url, "SELECT 1", return_type="arrow")
        except Exception as e:
            logger.error(f"Failed to connect to MySQL (mysql://{self.user}:***@{self.host}:{self.port}/{self.database}): {e}")
            raise ValueError(f"Failed to connect to MySQL database '{self.database}' on host '{self.host}': {e}") from e
        logger.info(f"Successfully connected to MySQL: mysql://{self.user}:***@{self.host}:{self.port}/{self.database}")

    def fetch_data_as_arrow(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pa.Table:
        """
        Fetch data from MySQL as a PyArrow Table using connectorx.
        
        connectorx provides extremely fast Arrow-native database access.
        """
        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Handle table names
        if '.' in source_table:
            base_query = f"SELECT * FROM {source_table}"
        else:
            base_query = f"SELECT * FROM `{source_table}`"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'`{col}` {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        query = f"{base_query}{order_by_clause} LIMIT {size}"
        
        logger.info(f"Executing MySQL query via connectorx: {query[:200]}...")
        
        arrow_table = cx.read_sql(self.connection_url, query, return_type="arrow")
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from MySQL [Arrow-native]")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List available tables from MySQL database."""
        return self._list_tables_connectorx(table_filter)
    
    def _list_tables_connectorx(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables using connectorx."""
        try:
            tables_query = f"""
                SELECT TABLE_SCHEMA, TABLE_NAME 
                FROM information_schema.tables 
                WHERE TABLE_SCHEMA = '{self.database}'
                AND TABLE_TYPE = 'BASE TABLE'
            """
            tables_arrow = cx.read_sql(self.connection_url, tables_query, return_type="arrow")
            tables_df = tables_arrow.to_pandas()
            
            if tables_df.empty:
                return []
            
            results = []
            
            for _, row in tables_df.iterrows():
                schema = row['TABLE_SCHEMA']
                table_name = row['TABLE_NAME']
                
                if table_filter and table_filter.lower() not in table_name.lower():
                    continue
                
                full_table_name = f"{schema}.{table_name}"
                
                try:
                    # Get column information
                    columns_query = f"""
                        SELECT COLUMN_NAME, DATA_TYPE 
                        FROM information_schema.columns 
                        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{table_name}'
                        ORDER BY ORDINAL_POSITION
                    """
                    columns_arrow = cx.read_sql(self.connection_url, columns_query, return_type="arrow")
                    columns_df = columns_arrow.to_pandas()
                    columns = [{
                        'name': col_row['COLUMN_NAME'],
                        'type': col_row['DATA_TYPE']
                    } for _, col_row in columns_df.iterrows()]
                    
                    # Get sample data
                    sample_query = f"SELECT * FROM `{schema}`.`{table_name}` LIMIT 10"
                    sample_arrow = cx.read_sql(self.connection_url, sample_query, return_type="arrow")
                    sample_df = sample_arrow.to_pandas()
                    sample_rows = json.loads(sample_df.to_json(orient="records", date_format='iso'))
                    
                    # Get row count
                    count_query = f"SELECT COUNT(*) as cnt FROM `{schema}`.`{table_name}`"
                    count_arrow = cx.read_sql(self.connection_url, count_query, return_type="arrow")
                    row_count = int(count_arrow.to_pandas()['cnt'].iloc[0])
                    
                    table_metadata = {
                        "row_count": row_count,
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