import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Dict, Any, Optional


class BigQueryDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "project_id", "type": "string", "required": True, "default": "", "description": "Google Cloud Project ID"},
            {"name": "dataset_id", "type": "string", "required": True, "default": "", "description": "BigQuery dataset ID"},
            {"name": "credentials_json", "type": "string", "required": True, "default": "", "description": "Service account credentials JSON (as string)"},
            {"name": "location", "type": "string", "required": False, "default": "US", "description": "BigQuery dataset location (default: US)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
Google BigQuery Connection Instructions:

1. Google Cloud Setup:
   - Create or select a Google Cloud Project
   - Enable the BigQuery API for your project
   - Create a service account with BigQuery permissions
   - Download the service account JSON key file

2. Authentication:
   - Copy the entire contents of your service account JSON key file
   - Paste it as the credentials_json parameter
   - Ensure your service account has appropriate BigQuery permissions:
     - bigquery.datasets.get
     - bigquery.tables.get
     - bigquery.tables.getData
     - bigquery.jobs.create

3. Required Parameters:
   - project_id: Your Google Cloud Project ID
   - dataset_id: Target BigQuery dataset ID
   - credentials_json: Complete service account JSON key content
   - location: Dataset location (optional, default: US)

4. Security Notes:
   - Never commit service account keys to version control
   - Use dedicated service accounts with minimal required permissions
   - Rotate service account keys regularly
   - Consider using Workload Identity for production deployments

5. Troubleshooting:
   - Verify your project ID and dataset ID are correct
   - Ensure the service account has access to the dataset
   - Check that the BigQuery API is enabled
   - Test connection using BigQuery web interface or bq command-line tool
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Install and load the BigQuery extension
        try:
            self.duck_db_conn.install_extension("bigquery")
            self.duck_db_conn.load_extension("bigquery")
        except Exception as e:
            raise Exception(f"BigQuery extension not available. Please install BigQuery extension for DuckDB: {e}")

        # Create temporary credentials file
        import tempfile
        import os

        credentials_json = params.get('credentials_json', '')
        if not credentials_json:
            raise Exception("BigQuery credentials JSON is required")

        # Write credentials to temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write(credentials_json)
            self.credentials_file = f.name

        # Build connection string for BigQuery
        attach_string = f"project_id={params.get('project_id', '')} "
        attach_string += f"dataset_id={params.get('dataset_id', '')} "
        attach_string += f"credentials_file={self.credentials_file} "
        if params.get('location'):
            attach_string += f"location={params.get('location')} "

        # Detach existing bigquerydb connection if it exists
        try:
            self.duck_db_conn.execute("DETACH bigquerydb;")
        except:
            pass  # Ignore if bigquerydb doesn't exist

        # Register BigQuery connection
        self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS bigquerydb (TYPE bigquery);")

    def __del__(self):
        # Clean up temporary credentials file
        try:
            if hasattr(self, 'credentials_file') and os.path.exists(self.credentials_file):
                os.unlink(self.credentials_file)
        except:
            pass

    def list_tables(self, table_filter: str = None):
        try:
            tables_df = self.duck_db_conn.execute(f"""
                SELECT table_catalog, table_schema, table_name
                FROM bigquerydb.information_schema.tables
                WHERE table_type = 'BASE TABLE'
            """).fetch_df()
        except Exception as e:
            # Fallback to SHOW TABLES command
            try:
                tables_df = self.duck_db_conn.execute("SHOW TABLES FROM bigquerydb").fetch_df()
                # Add catalog and schema columns
                tables_df['table_catalog'] = self.params.get('project_id', '')
                tables_df['table_schema'] = self.params.get('dataset_id', '')
                tables_df = tables_df[['table_catalog', 'table_schema', 'name']]
                tables_df.columns = ['table_catalog', 'table_schema', 'table_name']
            except Exception as e2:
                raise Exception(f"Unable to list tables from BigQuery: {e2}")

        results = []

        for table_catalog, table_schema, table_name in tables_df.values:
            full_table_name = f"bigquerydb.{table_catalog}.{table_schema}.{table_name}"

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
        # Create table in the main DuckDB database from BigQuery data
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
