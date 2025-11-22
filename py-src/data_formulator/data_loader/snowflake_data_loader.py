import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Dict, Any, Optional


class SnowflakeDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "", "description": "Snowflake username"},
            {"name": "password", "type": "string", "required": True, "default": "", "description": "Snowflake password"},
            {"name": "account", "type": "string", "required": True, "default": "", "description": "Snowflake account identifier (e.g., xy12345.us-west-2.aws)"},
            {"name": "warehouse", "type": "string", "required": True, "default": "", "description": "Snowflake warehouse name"},
            {"name": "database", "type": "string", "required": True, "default": "", "description": "Snowflake database name"},
            {"name": "schema", "type": "string", "required": False, "default": "PUBLIC", "description": "Snowflake schema name (default: PUBLIC)"},
            {"name": "role", "type": "string", "required": False, "default": "", "description": "Snowflake role (optional)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
Snowflake Connection Instructions:

1. Account Setup:
   - Obtain your Snowflake account identifier from your Snowflake administrator
   - Account format: [organization_name]-[account_name] or [account_locator].[region].[cloud_provider]
   - Example: xy12345.us-west-2.aws

2. Authentication:
   - Use your Snowflake username and password
   - Ensure your user has appropriate permissions on the target database and warehouse
   - Optionally specify a role if you need to assume a specific role

3. Required Parameters:
   - user: Your Snowflake username
   - password: Your Snowflake password
   - account: Snowflake account identifier
   - warehouse: Target warehouse name
   - database: Target database name
   - schema: Target schema name (default: PUBLIC)
   - role: Optional role to assume

4. Troubleshooting:
   - Verify your account identifier is correct
   - Ensure your user has access to the specified warehouse and database
   - Check that your IP is allowed in Snowflake's network policies
   - Test connection using Snowflake web interface or SnowSQL client
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Install and load the Snowflake extension
        try:
            self.duck_db_conn.install_extension("snowflake")
            self.duck_db_conn.load_extension("snowflake")
        except Exception as e:
            raise Exception(f"Snowflake extension not available. Please install Snowflake extension for DuckDB: {e}")

        # Build connection string for Snowflake
        attach_string = ""
        for key, value in self.params.items():
            if value is not None and value != "":
                attach_string += f"{key}={value} "

        # Detach existing snowflakedb connection if it exists
        try:
            self.duck_db_conn.execute("DETACH snowflakedb;")
        except:
            pass  # Ignore if snowflakedb doesn't exist

        # Register Snowflake connection
        self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS snowflakedb (TYPE snowflake);")

    def list_tables(self, table_filter: str = None):
        schema = self.params.get('schema', 'PUBLIC')

        try:
            tables_df = self.duck_db_conn.execute(f"""
                SELECT TABLE_SCHEMA, TABLE_NAME
                FROM snowflakedb.information_schema.tables
                WHERE table_schema = '{schema}'
                AND table_type = 'BASE TABLE'
            """).fetch_df()
        except Exception as e:
            # Fallback to SHOW TABLES command
            try:
                tables_df = self.duck_db_conn.execute(f"SHOW TABLES IN SCHEMA snowflakedb.{self.params.get('database', '')}.{schema}").fetch_df()
                tables_df = tables_df[['schema_name', 'name']]
                tables_df.columns = ['TABLE_SCHEMA', 'TABLE_NAME']
            except Exception as e2:
                raise Exception(f"Unable to list tables from Snowflake: {e2}")

        results = []

        for table_schema, table_name in tables_df.values:
            full_table_name = f"snowflakedb.{self.params.get('database', '')}.{table_schema}.{table_name}"

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
        # Create table in the main DuckDB database from Snowflake data
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
