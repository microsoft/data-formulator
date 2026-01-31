import json
import logging
import re
from typing import Any
import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from data_formulator.security import validate_sql_query

try:
    from google.cloud import bigquery
    from google.oauth2 import service_account
    BIGQUERY_AVAILABLE = True
except ImportError:
    BIGQUERY_AVAILABLE = False

log = logging.getLogger(__name__)

class BigQueryDataLoader(ExternalDataLoader):
    """BigQuery data loader implementation"""
    
    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "project_id", "type": "text", "required": True, "description": "Google Cloud Project ID", "default": ""},
            {"name": "dataset_id", "type": "text", "required": False, "description": "Dataset ID(s) - leave empty for all, or specify one (e.g., 'billing') or multiple separated by commas (e.g., 'billing,enterprise_collected,ga_api')", "default": ""},
            {"name": "credentials_path", "type": "text", "required": False, "description": "Path to service account JSON file (optional)", "default": ""},
            {"name": "location", "type": "text", "required": False, "description": "BigQuery location (default: US)", "default": "US"}
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """BigQuery Authentication Instructions

Authentication Options (choose one):

Option 1 - Application Default Credentials (Recommended)
    - Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install
    - Run `gcloud auth application-default login` in your terminal
    - Leave `credentials_path` parameter empty
    - Requires Google Cloud Project ID

Option 2 - Service Account Key File
    - Create a service account in Google Cloud Console
    - Download the JSON key file
    - Provide the full path to the JSON file in `credentials_path` parameter
    - Grant the service account BigQuery Data Viewer role (or appropriate permissions)

Option 3 - Environment Variables
    - Set GOOGLE_APPLICATION_CREDENTIALS environment variable to point to your service account JSON file
    - Leave `credentials_path` parameter empty

Required Permissions:
    - BigQuery Data Viewer (for reading data)
    - BigQuery Job User (for running queries)

Parameters:
    - project_id: Your Google Cloud Project ID (required)
    - dataset_id: Specific dataset to browse (optional - leave empty to see all datasets)
    - location: BigQuery location/region (default: US)
    - credentials_path: Path to service account JSON file (optional)

Supported Operations:
    - Browse datasets and tables
    - Preview table schemas and data
    - Import data from tables
    - Execute custom SQL queries
"""

    def __init__(self, params: dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        if not BIGQUERY_AVAILABLE:
            raise ImportError(
                "google-cloud-bigquery is required for BigQuery connections. "
                "Install with: pip install google-cloud-bigquery google-auth"
            )
        
        self.params = params
        self.duck_db_conn = duck_db_conn
        self.project_id = params.get("project_id")
        self.dataset_ids = [d.strip() for d in params.get("dataset_id", "").split(",") if d.strip()]  # Support multiple datasets
        self.location = params.get("location", "US")
        
        # Initialize BigQuery client
        if params.get("credentials_path"):
            credentials = service_account.Credentials.from_service_account_file(params["credentials_path"])
            self.client = bigquery.Client(
                project=self.project_id, 
                credentials=credentials, 
                location=self.location
            )
        else:
            # Use default credentials (ADC)
            self.client = bigquery.Client(
                project=self.project_id, 
                location=self.location
            )

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List tables from BigQuery datasets"""
        results = []
        
        try:
            log.info(f"Listing BigQuery datasets for project: {self.project_id}")
            
            # List datasets with timeout
            datasets = list(self.client.list_datasets(max_results=50))
            log.info(f"Found {len(datasets)} datasets")
            
            # Limit to first 10 datasets if no specific dataset is specified
            if not self.dataset_ids:
                datasets = datasets[:10]
            
            for dataset in datasets:
                dataset_id = dataset.dataset_id
                
                # Skip if we have specific datasets and this isn't one of them
                if self.dataset_ids and dataset_id not in self.dataset_ids:
                    continue
                
                try:
                    log.info(f"Processing dataset: {dataset_id}")
                    # List tables in dataset with limit
                    tables = list(self.client.list_tables(dataset.reference, max_results=20))
                    
                    for table in tables:
                        full_table_name = f"{self.project_id}.{dataset_id}.{table.table_id}"
                        
                        # Apply filter if provided
                        if table_filter and table_filter.lower() not in table.table_id.lower():
                            continue
                        
                        # Get basic table info without full schema for performance
                        try:
                            table_ref = self.client.get_table(table.reference)
                            columns = [{"name": field.name, "type": field.field_type} for field in table_ref.schema[:10]]  # Limit columns shown
                            
                            results.append({
                                "name": full_table_name,
                                "metadata": {
                                    "row_count": table_ref.num_rows or 0,
                                    "columns": columns,
                                    "sample_rows": []  # Empty for performance, can be populated later
                                }
                            })
                        except Exception as e:
                            log.warning(f"Error getting schema for table {full_table_name}: {e}")
                            # Add table without detailed schema
                            results.append({
                                "name": full_table_name,
                                "metadata": {
                                    "row_count": 0,
                                    "columns": [],
                                    "sample_rows": []
                                }
                            })
                        
                        # Limit total results for performance
                        if len(results) >= 100:
                            log.info("Reached 100 table limit, stopping enumeration")
                            return results
                        
                except Exception as e:
                    log.warning(f"Error accessing dataset {dataset_id}: {e}")
                    continue
                    
        except Exception as e:
            log.error(f"Error listing BigQuery tables: {e}")
            
        log.info(f"Returning {len(results)} tables")
        return results

    def _convert_bigquery_dtypes(self, df: pd.DataFrame) -> pd.DataFrame:
        """Convert BigQuery-specific dtypes to standard pandas dtypes"""

        def safe_convert(x):
            try:
                if x is None or pd.isna(x):
                    return None
                if isinstance(x, (dict, list)):
                    return json.dumps(x, default=str)
                if hasattr(x, "__dict__"):
                    return json.dumps(x.__dict__, default=str)
                s = str(x)
                if "[object Object]" in s:
                    return json.dumps(x, default=str)
                return s
            except Exception:
                return str(x) if x is not None else None

        for col in df.columns:
            # Convert db_dtypes.DateDtype to standard datetime
            if hasattr(df[col].dtype, "name") and "dbdate" in str(df[col].dtype).lower():
                df[col] = pd.to_datetime(df[col])
            # Convert other db_dtypes if needed
            elif str(df[col].dtype).startswith("db_dtypes"):
                try:
                    df[col] = df[col].astype(str)
                except Exception as e:
                   logging.error(f"Failed to convert column '{col}' to string: {e}")
            # Handle nested objects/JSON columns
            elif df[col].dtype == "object":
                df[col] = df[col].apply(safe_convert)

        return df

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000, sort_columns: list[str] | None = None, sort_order: str = 'asc'):
            """Ingest data from BigQuery table into DuckDB with stable, de-duplicated column aliases."""
            if name_as is None:
                name_as = table_name.split('.')[-1]

            name_as = sanitize_table_name(name_as)


            table_ref = self.client.get_table(table_name)

            select_parts: list[str] = []
            used_aliases: dict[str, str] = {}  # alias -> field_path

            def build_alias(field_path: str) -> str:
                """
                Build a human-readable, globally unique alias from a BigQuery field path.

                Examples:
                    'geo.country'        -> 'geo_country'
                    'device.category'    -> 'device_category'
                    'event_params.value' -> 'event_params_value'
                """
                # path "a.b.c" -> "a_b_c"
                alias = field_path.replace('.', '_')

                # remove weird characters
                alias = re.sub(r'[^0-9a-zA-Z_]', '_', alias)
                alias = re.sub(r'_+', '_', alias).strip('_') or "col"

                # must start with letter or underscore
                if not alias[0].isalpha() and alias[0] != '_':
                    alias = f"_{alias}"

                base_alias = alias
                counter = 1
                while alias in used_aliases:
                    # same alias from another path – suffix and log once
                    alias = f"{base_alias}_{counter}"
                    counter += 1

                used_aliases[alias] = field_path
                return alias

            def add_field(field_path: str):
                alias = build_alias(field_path)
                select_parts.append(f"`{table_name}`.{field_path} AS `{alias}`")

            def process_field(field, parent_path: str = ""):
                """
                Recursively process fields, flattening non-repeated RECORDs.
                """
                current_path = f"{parent_path}.{field.name}" if parent_path else field.name

                # Flatten STRUCT / RECORD that is not REPEATED
                if field.field_type == "RECORD" and field.mode != "REPEATED":
                    for subfield in field.fields:
                        process_field(subfield, current_path)
                else:
                    # Regular field or REPEATED RECORD/array – select as a single column
                    add_field(current_path)

            # Process all top-level fields
            for field in table_ref.schema:
                process_field(field)

            if not select_parts:
                raise ValueError(f"No fields found for table {table_name}")

            # Build ORDER BY clause if sort_columns are specified
            order_by_clause = ""
            if sort_columns and len(sort_columns) > 0:
                # Use backticks for BigQuery column quoting
                order_direction = "DESC" if sort_order == 'desc' else "ASC"
                sanitized_cols = [f'`{col}` {order_direction}' for col in sort_columns]
                order_by_clause = f"ORDER BY {', '.join(sanitized_cols)}"

            query = f"SELECT {', '.join(select_parts)} FROM `{table_name}` {order_by_clause} LIMIT {size}"

            df = self.client.query(query).to_dataframe()

            # Safety net: drop exact duplicate names if something slipped through
            if df.columns.duplicated().any():
                dupes = df.columns[df.columns.duplicated()].tolist()
                log.warning(f"Duplicate column names detected in DataFrame, dropping later ones: {dupes}")
                df = df.loc[:, ~df.columns.duplicated()]


            # Convert BigQuery-specific dtypes
            df = self._convert_bigquery_dtypes(df)

            self.ingest_df_to_duckdb(df, name_as)

    def view_query_sample(self, query: str) -> list[dict[str, Any]]:
        """Execute query and return sample results as a list of dictionaries"""
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        # Add LIMIT if not present
        if "LIMIT" not in query.upper():
            query += " LIMIT 10"
        
        df = self.client.query(query).to_dataframe()
        return json.loads(df.to_json(orient="records"))

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        """Execute custom query and ingest results into DuckDB"""
        name_as = sanitize_table_name(name_as)
        
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        # Execute query and get DataFrame
        df = self.client.query(query).to_dataframe()

        # Drop duplicate columns
        df = df.loc[:, ~df.columns.duplicated()]

        # Convert BigQuery-specific dtypes
        df = self._convert_bigquery_dtypes(df)

        # Use base class method to ingest DataFrame
        self.ingest_df_to_duckdb(df, name_as)
        
        return df
