import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Dict, Any, Optional


class ClickHouseDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "default", "description": ""},
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"},
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": ""},
            {"name": "port", "type": "int", "required": False, "default": 9000, "description": "ClickHouse native protocol port (default 9000)"},
            {"name": "database", "type": "string", "required": True, "default": "default", "description": ""}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
ClickHouse Connection Instructions:

1. Local ClickHouse Setup:
   - Ensure ClickHouse server is running on your machine
   - Default connection: host='localhost', user='default', port=9000
   - If you haven't set a password, leave password field empty

2. Remote ClickHouse Connection:
   - Obtain host address, port, username, and password from your database administrator
   - Ensure the ClickHouse server allows remote connections
   - Check that your user has appropriate permissions

3. Common Connection Parameters:
   - user: Your ClickHouse username (default: 'default')
   - password: Your ClickHouse password (leave empty if no password set)
   - host: ClickHouse server address (default: 'localhost')
   - port: ClickHouse native protocol port (default: 9000)
   - database: Target database name to connect to

4. Troubleshooting:
   - Verify ClickHouse service is running
   - Test connection using clickhouse-client: `clickhouse-client -u [username] -h [host] --port [port] --database [database]`
   - Check ClickHouse logs for connection errors
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Install and load the ClickHouse extension
        try:
            self.duck_db_conn.install_extension("clickhouse")
            self.duck_db_conn.load_extension("clickhouse")
        except Exception as e:
            raise Exception(f"ClickHouse extension not available. Please install ClickHouse extension for DuckDB: {e}")

        attach_string = ""
        for key, value in self.params.items():
            if value is not None and value != "":
                attach_string += f"{key}={value} "

        # Detach existing clickhousedb connection if it exists
        try:
            self.duck_db_conn.execute("DETACH clickhousedb;")
        except:
            pass  # Ignore if clickhousedb doesn't exist

        # Register ClickHouse connection
        self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS clickhousedb (TYPE clickhouse);")

    def list_tables(self, table_filter: str = None):
        try:
            tables_df = self.duck_db_conn.execute(f"""
                SELECT database, name as table_name
                FROM clickhousedb.system.tables
                WHERE database NOT IN ('system', 'information_schema')
            """).fetch_df()
        except Exception as e:
            # Fallback to a simpler query if system.tables is not accessible
            try:
                tables_df = self.duck_db_conn.execute(f"SHOW TABLES FROM clickhousedb.{self.params.get('database', 'default')}").fetch_df()
                tables_df.columns = ['table_name']
                tables_df['database'] = self.params.get('database', 'default')
            except Exception as e2:
                raise Exception(f"Unable to list tables from ClickHouse: {e2}")

        results = []

        for database, table_name in tables_df.values:
            full_table_name = f"clickhousedb.{database}.{table_name}"

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

                # Get row count (approximate for performance)
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
        # Create table in the main DuckDB database from ClickHouse data
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
