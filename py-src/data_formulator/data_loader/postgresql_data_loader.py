import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Any

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
        return "Provide your PostgreSQL connection details. The user must have SELECT permissions on the tables you want to access."

    def __init__(self, params: dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Get params as-is from frontend
        host = self.params.get('host', '')
        port = self.params.get('port', '') or '5432'  # Only port has a sensible default
        user = self.params.get('user', '')
        database = self.params.get('database', '')
        password = self.params.get('password', '')
        
        # Validate required params
        if not host:
            raise ValueError("PostgreSQL host is required")
        if not user:
            raise ValueError("PostgreSQL user is required")
        if not database:
            raise ValueError("PostgreSQL database is required")
        
        # Create a sanitized version for logging (excludes password)
        sanitized_attach_string = f"host={host} port={port} user={user} dbname={database}"
        
        try:
            # Install and load the Postgres extension
            self.duck_db_conn.install_extension("postgres")
            self.duck_db_conn.load_extension("postgres")
            
            # Prepare the connection string for Postgres
            # Note: attach_string contains sensitive credentials - do not log it
            password_part = f" password={password}" if password else ""
            attach_string = f"host={host} port={port} user={user}{password_part} dbname={database}"
            
            # Detach existing postgres connection if it exists 
            try:
                self.duck_db_conn.execute("DETACH mypostgresdb;")
            except:
                pass  # Ignore if connection doesn't exist

            # Register Postgres connection
            self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS mypostgresdb (TYPE postgres);")
            print(f"Successfully connected to PostgreSQL database: {database}")
            
        except Exception as e:
            # Log error with sanitized connection string to avoid exposing password
            error_type = type(e).__name__
            print(f"Failed to connect to PostgreSQL ({sanitized_attach_string}): {error_type}")
            raise ValueError(f"Failed to connect to PostgreSQL database '{database}' on host '{host}': {error_type}")

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
            
            print(f"Found tables: {tables_df}")

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
                    print(f"Error processing table {full_table_name}: {e}")
                    continue
                    
            return results
            
        except Exception as e:
            print(f"Error listing tables: {e}")
            return []

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000, sort_columns: list[str] | None = None, sort_order: str = 'asc'):
        # Create table in the main DuckDB database from Postgres data
        if name_as is None:
            name_as = table_name.split('.')[-1]

        name_as = sanitize_table_name(name_as)

        # Build ORDER BY clause if sort_columns are specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            # Sanitize column names to prevent SQL injection
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'"{col}" {order_direction}' for col in sort_columns]
            order_by_clause = f"ORDER BY {', '.join(sanitized_cols)}"

        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE main.{name_as} AS 
            SELECT * FROM {table_name} 
            {order_by_clause}
            LIMIT {size}
        """)
