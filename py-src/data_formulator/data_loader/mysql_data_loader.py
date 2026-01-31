import json
import logging

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Any

try:
    import pymysql
    PYMYSQL_AVAILABLE = True
except ImportError:
    PYMYSQL_AVAILABLE = False

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

    def __init__(self, params: dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        if not PYMYSQL_AVAILABLE:
            raise ImportError(
                "pymysql is required for MySQL connections. "
                "Install with: pip install pymysql"
            )
        
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Get params as-is from frontend
        host = self.params.get('host', '')
        user = self.params.get('user', '')
        password = self.params.get('password', '')
        database = self.params.get('database', '')
        
        # Validate required params
        if not host:
            raise ValueError("MySQL host is required")
        if not user:
            raise ValueError("MySQL user is required")
        if not database:
            raise ValueError("MySQL database is required")
        
        # Handle port (only field with sensible default)
        port = self.params.get('port', '')
        if isinstance(port, str):
            port = int(port) if port else 3306
        elif not port:
            port = 3306
        
        try:
            self.mysql_conn = pymysql.connect(
                host=host,
                user=user,
                password=password,
                database=database,
                port=port,
                cursorclass=pymysql.cursors.DictCursor,
                charset='utf8mb4'
            )
            self.database = database
            logger.info(f"Successfully connected to MySQL database: {self.database}")
        except Exception as e:
            logger.error(f"Failed to connect to MySQL: {e}")
            raise

    def _execute_query(self, query: str, params: tuple = None) -> pd.DataFrame:
        """Execute a query using native MySQL connection and return a DataFrame.
        
        Args:
            query: SQL query string. Use %s for parameterized queries.
            params: Optional tuple of parameters for parameterized queries.
        """
        try:
            with self.mysql_conn.cursor() as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
                if rows:
                    return pd.DataFrame(rows)
                else:
                    # Return empty DataFrame with column names
                    return pd.DataFrame()
        except Exception as e:
            logger.error(f"Error executing MySQL query: {e}")
            # Try to reconnect if connection was lost
            self._reconnect_if_needed()
            raise

    def _reconnect_if_needed(self):
        """Attempt to reconnect to MySQL if the connection was lost."""
        try:
            self.mysql_conn.ping(reconnect=True)
        except Exception as e:
            logger.warning(f"Reconnection attempt failed: {e}")
            # Try to create a new connection using stored params
            host = self.params.get('host', '')
            user = self.params.get('user', '')
            password = self.params.get('password', '')
            
            port = self.params.get('port', '')
            if isinstance(port, str):
                port = int(port) if port else 3306
            elif not port:
                port = 3306
            
            self.mysql_conn = pymysql.connect(
                host=host,
                user=user,
                password=password,
                database=self.database,
                port=port,
                cursorclass=pymysql.cursors.DictCursor,
                charset='utf8mb4'
            )

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        # Get list of tables from the connected database
        # Filter by the specific database we're connected to for better performance
        tables_query = """
            SELECT TABLE_SCHEMA, TABLE_NAME 
            FROM information_schema.tables 
            WHERE TABLE_SCHEMA = %s
            AND TABLE_TYPE = 'BASE TABLE'
        """
        tables_df = self._execute_query(tables_query, (self.database,))
        
        if tables_df.empty:
            return []

        results = []
        
        for _, row in tables_df.iterrows():
            schema = row['TABLE_SCHEMA']
            table_name = row['TABLE_NAME']

            # Apply table filter if provided
            if table_filter and table_filter.lower() not in table_name.lower():
                continue

            full_table_name = f"{schema}.{table_name}"

            try:
                # Get column information from MySQL
                columns_query = (
                    "SELECT COLUMN_NAME, DATA_TYPE "
                    "FROM information_schema.columns "
                    "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s "
                    "ORDER BY ORDINAL_POSITION"
                )
                columns_df = self._execute_query(columns_query, (schema, table_name))
                columns = [{
                    'name': col_row['COLUMN_NAME'],
                    'type': col_row['DATA_TYPE']
                } for _, col_row in columns_df.iterrows()]
                
                # Get sample data
                sample_query = "SELECT * FROM `{}`.`{}` LIMIT 10".format(schema, table_name)
                sample_df = self._execute_query(sample_query)
                sample_rows = json.loads(sample_df.to_json(orient="records", date_format='iso'))
                
                # Get row count
                count_query = "SELECT COUNT(*) as cnt FROM `{}`.`{}`".format(schema, table_name)
                count_df = self._execute_query(count_query)
                row_count = int(count_df['cnt'].iloc[0]) if not count_df.empty else 0

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

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000, sort_columns: list[str] | None = None, sort_order: str = 'asc'):
        """Fetch data from MySQL and ingest into DuckDB."""
        if name_as is None:
            name_as = table_name.split('.')[-1]

        name_as = sanitize_table_name(name_as)

        # Validate and sanitize table name components
        sanitized_size = None
        try:
            sanitized_size = int(size)
            if sanitized_size <= 0:
                raise ValueError("Size must be a positive integer.")
        except Exception:
            raise ValueError("Size parameter must be a positive integer.")

        # Build ORDER BY clause if sort_columns are specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            # Use backticks for MySQL column quoting
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'`{col}` {order_direction}' for col in sort_columns]
            order_by_clause = f"ORDER BY {', '.join(sanitized_cols)}"

        if '.' in table_name:
            parts = table_name.split('.')
            schema = sanitize_table_name(parts[0])
            tbl = sanitize_table_name(parts[1])
            query = f"SELECT * FROM `{schema}`.`{tbl}` {order_by_clause} LIMIT {sanitized_size}"
        else:
            sanitized_table_name = sanitize_table_name(table_name)
            query = f"SELECT * FROM `{sanitized_table_name}` {order_by_clause} LIMIT {sanitized_size}"

        # Fetch data from MySQL
        df = self._execute_query(query)
        
        if df.empty:
            logger.warning(f"No data fetched from table {table_name}")
            return
        
        # Ingest into DuckDB using the base class method
        self.ingest_df_to_duckdb(df, name_as)
        logger.info(f"Successfully ingested {len(df)} rows from {table_name} into DuckDB table {name_as}")

    def view_query_sample(self, query: str) -> list[dict[str, Any]]:
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        # Execute query via native MySQL connection
        df = self._execute_query(query)
        return json.loads(df.head(10).to_json(orient="records", date_format='iso'))

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        """Execute custom query and ingest results into DuckDB."""
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        # Execute query via native MySQL connection
        df = self._execute_query(query)
        
        # Ingest into DuckDB using the base class method
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as))
        return df

    def close(self):
        """Explicitly close the MySQL connection."""
        if hasattr(self, 'mysql_conn') and self.mysql_conn:
            try:
                self.mysql_conn.close()
            except Exception as e:
                logger.warning(f"Error closing MySQL connection: {e}")

    def __enter__(self):
        """Support context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Support context manager exit and cleanup."""
        self.close()

    def __del__(self):
        """Clean up MySQL connection when the loader is destroyed."""
        try:
            self.close()
        except Exception:
            # Ignore errors during destruction to prevent exceptions in garbage collection
            pass