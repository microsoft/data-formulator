import json
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from typing import Dict, Any, List, Optional
from data_formulator.security import validate_sql_query

log = logging.getLogger(__name__)

# Default connection timeout in seconds
DEFAULT_CONNECTION_TIMEOUT = 30


class PostgreSQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params()  -> List[Dict[str, Any]]:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "postgres", "description": "PostgreSQL username"}, 
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": "PostgreSQL host"}, 
            {"name": "port", "type": "string", "required": False, "default": "5432", "description": "PostgreSQL port"},
            {"name": "database", "type": "string", "required": True, "default": "postgres", "description": "PostgreSQL database name"},
            {"name": "connection_timeout", "type": "int", "required": False, "default": 30, "description": "Connection timeout in seconds (default 30)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return "Provide your PostgreSQL connection details. The user must have SELECT permissions on the tables you want to access."

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Get connection timeout (default 30 seconds)
        connection_timeout = int(params.get('connection_timeout', DEFAULT_CONNECTION_TIMEOUT))
        if connection_timeout <= 0:
            connection_timeout = DEFAULT_CONNECTION_TIMEOUT
        
        try:
            # Install and load the Postgres extension
            self.duck_db_conn.install_extension("postgres")
            self.duck_db_conn.load_extension("postgres")
            
            # Prepare the connection string for Postgres (excluding connection_timeout)
            port = self.params.get('port', '5432')
            password_part = f" password={self.params.get('password', '')}" if self.params.get('password') else ""
            attach_string = f"host={self.params['host']} port={port} user={self.params['user']}{password_part} dbname={self.params['database']}"
            
            # Detach existing postgres connection if it exists 
            try:
                self.duck_db_conn.execute("DETACH mypostgresdb;")
            except Exception:
                pass  # Ignore if connection doesn't exist

            # Use ThreadPoolExecutor to implement connection timeout
            # DuckDB PostgreSQL extension doesn't support native timeout parameters
            def attach_postgres():
                self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS mypostgresdb (TYPE postgres);")
            
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(attach_postgres)
                try:
                    future.result(timeout=connection_timeout)
                    log.info(f"Successfully connected to PostgreSQL database: {self.params.get('database', 'unknown')}")
                except FuturesTimeoutError:
                    # Cancel the future if possible
                    future.cancel()
                    error_msg = (
                        f"Connection to PostgreSQL server timed out after {connection_timeout} seconds. "
                        f"Please check:\n"
                        f"  - The PostgreSQL server at '{self.params.get('host', 'localhost')}:{self.params.get('port', '5432')}' is running and accessible\n"
                        f"  - Network connectivity and firewall settings allow the connection\n"
                        f"  - The provided credentials are correct\n"
                        f"  - Try increasing the connection_timeout parameter if the server is slow"
                    )
                    log.error(error_msg)
                    raise ConnectionError(error_msg)
            
        except ConnectionError:
            raise  # Re-raise connection errors as-is
        except Exception as e:
            error_msg = f"Failed to connect to PostgreSQL server: {str(e)}"
            log.error(error_msg)
            raise ConnectionError(error_msg)

    def list_tables(self):
        try:
            # Query tables through DuckDB's attached PostgreSQL connection
            tables_df = self.duck_db_conn.execute("""
                SELECT table_schema as schemaname, table_name as tablename 
                FROM mypostgresdb.information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
                AND table_schema NOT LIKE '%_intern%' 
                AND table_schema NOT LIKE '%timescaledb%'
                AND table_name NOT LIKE '%/%'
                AND table_type = 'BASE TABLE'
                ORDER BY table_schema, table_name
            """).fetch_df()
            
            log.info(f"Found {len(tables_df)} tables")

            results = []
            
            for schema, table_name in tables_df.values:
                full_table_name = f"mypostgresdb.{schema}.{table_name}"

                try:
                    # Get column information using DuckDB's DESCRIBE
                    columns_df = self.duck_db_conn.execute(f"DESCRIBE {full_table_name}").df()
                    columns = [{
                        'name': row['column_name'],
                        'type': row['column_type']
                    } for _, row in columns_df.iterrows()]
                    
                    # Get sample data
                    sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").df()
                    sample_rows = json.loads(sample_df.to_json(orient="records"))
                    
                    # Get row count
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
                    
                except Exception as e:
                    log.warning(f"Error processing table {full_table_name}: {e}")
                    continue
                    
            return results
            
        except Exception as e:
            log.error(f"Error listing tables: {e}")
            return []

    def ingest_data(self, table_name: str, name_as: Optional[str] = None, size: int = 1000000):
        # Create table in the main DuckDB database from Postgres data
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
        return df
