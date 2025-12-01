import json
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Dict, Any, Optional

log = logging.getLogger(__name__)

# Default connection timeout in seconds
DEFAULT_CONNECTION_TIMEOUT = 30


class MySQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "root", "description": ""}, 
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": ""}, 
            {"name": "port", "type": "int", "required": False, "default": 3306, "description": "MySQL server port (default 3306)"},
            {"name": "database", "type": "string", "required": True, "default": "mysql", "description": ""},
            {"name": "connection_timeout", "type": "int", "required": False, "default": 30, "description": "Connection timeout in seconds (default 30)"}
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

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Get connection timeout (default 30 seconds)
        connection_timeout = int(params.get('connection_timeout', DEFAULT_CONNECTION_TIMEOUT))
        if connection_timeout <= 0:
            connection_timeout = DEFAULT_CONNECTION_TIMEOUT
        
        try:
            # Install and load the MySQL extension
            self.duck_db_conn.install_extension("mysql")
            self.duck_db_conn.load_extension("mysql")
            
            # Build attach string excluding connection_timeout (not a MySQL parameter)
            attach_string = ""
            for key, value in self.params.items():
                if key == 'connection_timeout':
                    continue  # Skip timeout param, it's not a MySQL connection parameter
                if value is not None and value != "":
                    attach_string += f"{key}={value} "

            # Detach existing mysqldb connection if it exists
            try:
                self.duck_db_conn.execute("DETACH mysqldb;")
            except Exception:
                pass  # Ignore if mysqldb doesn't exist
            
            # Use ThreadPoolExecutor to implement connection timeout
            # DuckDB MySQL extension doesn't support native timeout parameters
            def attach_mysql():
                self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS mysqldb (TYPE mysql);")
            
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(attach_mysql)
                try:
                    future.result(timeout=connection_timeout)
                    log.info(f"Successfully connected to MySQL database: {self.params.get('database', 'unknown')}")
                except FuturesTimeoutError:
                    # Cancel the future if possible (note: this won't stop the underlying thread immediately)
                    future.cancel()
                    error_msg = (
                        f"Connection to MySQL server timed out after {connection_timeout} seconds. "
                        f"Please check:\n"
                        f"  - The MySQL server at '{self.params.get('host', 'localhost')}:{self.params.get('port', 3306)}' is running and accessible\n"
                        f"  - Network connectivity and firewall settings allow the connection\n"
                        f"  - The provided credentials are correct\n"
                        f"  - Try increasing the connection_timeout parameter if the server is slow"
                    )
                    log.error(error_msg)
                    raise ConnectionError(error_msg)
                    
        except ConnectionError:
            raise  # Re-raise connection errors as-is
        except Exception as e:
            error_msg = f"Failed to connect to MySQL server: {str(e)}"
            log.error(error_msg)
            raise ConnectionError(error_msg)

    def list_tables(self, table_filter: str = None):
        tables_df = self.duck_db_conn.execute(f"""
            SELECT TABLE_SCHEMA, TABLE_NAME FROM mysqldb.information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        """).fetch_df()

        results = []
        
        for schema, table_name in tables_df.values:

            full_table_name = f"mysqldb.{schema}.{table_name}"

            # Apply table filter if provided
            if table_filter and table_filter.lower() not in table_name.lower():
                continue

            # Get column information using DuckDB's information schema
            columns_df = self.duck_db_conn.execute(f"DESCRIBE {full_table_name}").df()
            columns = [{
                'name': row['column_name'],
                'type': row['column_type']
            } for _, row in columns_df.iterrows()]
            
            # Get sample data
            sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").df()
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            
            # get row count
            row_count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM {full_table_name}").fetchone()[0]

            table_metadata = {
                "row_count": row_count,
                "columns": columns,
                "sample_rows": sample_rows
            }
            
            results.append({
                "name": full_table_name,
                "metadata": table_metadata
            })
            
        return results

    def ingest_data(self, table_name: str, name_as: Optional[str] = None, size: int = 1000000):
        # Create table in the main DuckDB database from MySQL data
        if name_as is None:
            name_as = table_name.split('.')[-1]

        name_as = sanitize_table_name(name_as)

        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE main.{name_as} AS 
            SELECT * FROM {table_name} 
            LIMIT {size}
        """)

    def view_query_sample(self, query: str) -> str:
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        return json.loads(self.duck_db_conn.execute(query).df().head(10).to_json(orient="records"))

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        # Execute the query and get results as a DataFrame
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        df = self.duck_db_conn.execute(query).df()
        # Use the base class's method to ingest the DataFrame
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as))