import logging
import re
from typing import Any
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from google.cloud import bigquery
from google.oauth2 import service_account

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

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.project_id = params.get("project_id")
        self.dataset_ids = [d.strip() for d in params.get("dataset_id", "").split(",") if d.strip()]
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
        
        log.info(f"Successfully connected to BigQuery project: {self.project_id}")

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

    def fetch_data_as_arrow(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pa.Table:
        """
        Fetch data from BigQuery as a PyArrow Table using native Arrow support.
        
        BigQuery's Python client provides .to_arrow() for efficient Arrow-native
        data transfer, avoiding pandas conversion overhead.
        """
        if not source_table:
            raise ValueError("source_table must be provided")
        
        # Get table schema to handle nested fields
        table_ref = self.client.get_table(source_table)
        select_parts = self._build_select_parts(table_ref, source_table)
        base_query = f"SELECT {', '.join(select_parts)} FROM `{source_table}`"
        
        # Add ORDER BY if sort columns specified
        order_by_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "DESC" if sort_order == 'desc' else "ASC"
            sanitized_cols = [f'`{col}` {order_direction}' for col in sort_columns]
            order_by_clause = f" ORDER BY {', '.join(sanitized_cols)}"
        
        query = f"{base_query}{order_by_clause} LIMIT {size}"
        
        log.info(f"Executing BigQuery query: {query[:200]}...")
        
        # Execute query and get Arrow table directly (no pandas conversion)
        query_job = self.client.query(query)
        arrow_table = query_job.to_arrow()
        
        log.info(f"Fetched {arrow_table.num_rows} rows from BigQuery [Arrow-native]")
        
        return arrow_table
    
    def _build_select_parts(self, table_ref, table_name: str) -> list[str]:
        """Build SELECT parts handling nested BigQuery fields."""
        select_parts: list[str] = []
        used_aliases: dict[str, str] = {}

        def build_alias(field_path: str) -> str:
            alias = field_path.replace('.', '_')
            alias = re.sub(r'[^0-9a-zA-Z_]', '_', alias)
            alias = re.sub(r'_+', '_', alias).strip('_') or "col"
            if not alias[0].isalpha() and alias[0] != '_':
                alias = f"_{alias}"
            base_alias = alias
            counter = 1
            while alias in used_aliases:
                alias = f"{base_alias}_{counter}"
                counter += 1
            used_aliases[alias] = field_path
            return alias

        def add_field(field_path: str):
            alias = build_alias(field_path)
            select_parts.append(f"`{table_name}`.{field_path} AS `{alias}`")

        def process_field(field, parent_path: str = ""):
            current_path = f"{parent_path}.{field.name}" if parent_path else field.name
            if field.field_type == "RECORD" and field.mode != "REPEATED":
                for subfield in field.fields:
                    process_field(subfield, current_path)
            else:
                add_field(current_path)

        for field in table_ref.schema:
            process_field(field)

        return select_parts if select_parts else ["*"]
