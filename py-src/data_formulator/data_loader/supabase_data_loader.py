import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Dict, Any, Optional


class SupabaseDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "postgres", "description": "Supabase database user"},
            {"name": "password", "type": "string", "required": True, "default": "", "description": "Supabase database password"},
            {"name": "host", "type": "string", "required": True, "default": "", "description": "Supabase project URL (without https://)"},
            {"name": "port", "type": "int", "required": False, "default": 5432, "description": "PostgreSQL port (default 5432)"},
            {"name": "database", "type": "string", "required": True, "default": "postgres", "description": "Database name"},
            {"name": "schema", "type": "string", "required": False, "default": "public", "description": "Schema name (default: public)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
Supabase Connection Instructions:

1. Project Setup:
   - Go to your Supabase project dashboard
   - Navigate to Settings > Database
   - Copy the connection details from the "Connection parameters" section

2. Connection Details:
   - Host: Your project URL (e.g., your-project.supabase.co)
   - Port: 5432 (default PostgreSQL port)
   - Database: postgres
   - User: postgres
   - Password: Your database password (found in Settings > Database)
   - Schema: public (default)

3. Security Considerations:
   - Use the database password, not your Supabase account password
   - Ensure Row Level Security (RLS) policies allow your queries
   - Consider using connection pooling for production workloads

4. Required Parameters:
   - user: postgres (default)
   - password: Your Supabase database password
   - host: Your Supabase project URL
   - port: 5432
   - database: postgres
   - schema: public

5. Troubleshooting:
   - Verify your project URL is correct
   - Ensure your database password is correct
   - Check that your IP is allowed in Supabase's allowlist
   - Test connection using any PostgreSQL client
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Install and load the PostgreSQL extension (Supabase uses PostgreSQL)
        try:
            self.duck_db_conn.install_extension("postgres")
            self.duck_db_conn.load_extension("postgres")
        except Exception as e:
            raise Exception(f"PostgreSQL extension not available. Please install PostgreSQL extension for DuckDB: {e}")

        # Build connection string for Supabase (PostgreSQL)
        attach_string = ""
        for key, value in self.params.items():
            if value is not None and value != "":
                attach_string += f"{key}={value} "

        # Detach existing supabasedb connection if it exists
        try:
            self.duck_db_conn.execute("DETACH supabasedb;")
        except:
            pass  # Ignore if supabasedb doesn't exist

        # Register Supabase connection
        self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS supabasedb (TYPE postgres);")

    def list_tables(self, table_filter: str = None):
        schema = self.params.get('schema', 'public')

        try:
            tables_df = self.duck_db_conn.execute(f"""
                SELECT schemaname, tablename
                FROM supabasedb.pg_catalog.pg_tables
                WHERE schemaname = '{schema}'
                AND tablename NOT LIKE 'pg_%'
                AND tablename NOT LIKE 'sql_%'
            """).fetch_df()
        except Exception as e:
            # Fallback to information_schema
            try:
                tables_df = self.duck_db_conn.execute(f"""
                    SELECT table_schema, table_name
                    FROM supabasedb.information_schema.tables
                    WHERE table_schema = '{schema}'
                    AND table_type = 'BASE TABLE'
                """).fetch_df()
            except Exception as e2:
                raise Exception(f"Unable to list tables from Supabase: {e2}")

        results = []

        for table_schema, table_name in tables_df.values:
            full_table_name = f"supabasedb.{table_schema}.{table_name}"

            # Apply table filter if provided
            if table_filter and table_filter.lower() not in table_name.lower():
                continue

            try:
                # Get column information
                columns_df = self.duck_db_conn.execute(f"DESCRIBE {full_table_name}").df()
                columns = [{
                    'name': row['column_name'],
                    'type': row['column_type']
                } for _, row in columns_df.iterrows()]

                # Get sample data
                sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").df()
                sample_rows = json.loads(sample_df.to_json(orient="records"))

                # Get row count
                try:
                    row_count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM {full_table_name}").fetchone()[0]
                except:
                    row_count = -1  # Unknown count

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
                # Skip tables that can't be accessed
                continue

        return results

    def ingest_data(self, table_name: str, name_as: Optional[str] = None, size: int = 1000000):
        # Create table in the main DuckDB database from Supabase data
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
