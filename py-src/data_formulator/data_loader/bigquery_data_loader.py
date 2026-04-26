import logging
import re
from typing import Any
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, sanitize_table_name

from google.cloud import bigquery
from google.oauth2 import service_account

log = logging.getLogger(__name__)

class BigQueryDataLoader(ExternalDataLoader):
    """BigQuery data loader implementation"""
    
    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        return [
            {"name": "project_id", "type": "text", "required": True, "tier": "connection", "description": "Google Cloud Project ID", "default": ""},
            {"name": "dataset_id", "type": "text", "required": False, "tier": "filter", "description": "Dataset ID(s) - leave empty for all, or specify one (e.g., 'billing') or multiple separated by commas (e.g., 'billing,enterprise_collected,ga_api')", "default": ""},
            {"name": "credentials_path", "type": "text", "required": False, "tier": "auth", "description": "Path to service account JSON file (optional)", "default": ""},
            {"name": "location", "type": "text", "required": False, "tier": "connection", "description": "BigQuery location (default: US)", "default": "US"}
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** project_id: `my-gcp-project` · dataset_id: `analytics` · credentials_path: `/path/to/key.json` · location: `US`

**Option 1 — Application Default Credentials (recommended):**
Install [Google Cloud SDK](https://cloud.google.com/sdk/docs/install), then run `gcloud auth application-default login`. Leave `credentials_path` empty.

**Option 2 — Service Account Key File:**
Create a service account in Google Cloud Console, download the JSON key, and enter the full path in `credentials_path`. Grant the account **BigQuery Data Viewer** and **BigQuery Job User** roles.

**Option 3 — Environment Variable:**
Set `GOOGLE_APPLICATION_CREDENTIALS` to your service account JSON file path. Leave `credentials_path` empty."""

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
                            columns = []
                            for f in table_ref.schema:
                                col: dict[str, Any] = {"name": f.name, "type": f.field_type}
                                if f.description:
                                    col["description"] = f.description
                                columns.append(col)

                            metadata: dict[str, Any] = {
                                "row_count": table_ref.num_rows or 0,
                                "columns": columns,
                            }
                            if table_ref.description:
                                metadata["description"] = table_ref.description

                            results.append({
                                "name": full_table_name,
                                "path": [dataset_id, table.table_id],
                                "metadata": metadata,
                            })
                        except Exception as e:
                            log.warning(f"Error getting schema for table {full_table_name}: {e}")
                            results.append({
                                "name": full_table_name,
                                "path": [dataset_id, table.table_id],
                                "metadata": {"columns": []},
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
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from BigQuery as a PyArrow Table using native Arrow support.
        
        BigQuery's Python client provides .to_arrow() for efficient Arrow-native
        data transfer, avoiding pandas conversion overhead.
        """
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

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

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "project_id", "label": "Project"},
            {"key": "dataset_id", "label": "Dataset"},
            {"key": "table", "label": "Table"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "project_id":
            # Project is always pinned (required param), but just in case
            return [CatalogNode(name=self.project_id, node_type="namespace", path=path + [self.project_id])]

        if level_key == "dataset_id":
            datasets = list(self.client.list_datasets(max_results=200))
            nodes = []
            for ds in datasets:
                name = ds.dataset_id
                if self.dataset_ids and name not in self.dataset_ids:
                    continue
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="namespace", path=path + [name]))
            return nodes

        if level_key == "table":
            pinned = self.pinned_scope()
            remaining = list(path)
            # project is always pinned
            dataset = pinned.get("dataset_id")
            if not dataset:
                if not remaining:
                    return []
                dataset = remaining.pop(0)
            dataset_ref = f"{self.project_id}.{dataset}"
            tables = list(self.client.list_tables(dataset_ref, max_results=500))
            nodes = []
            for t in tables:
                name = t.table_id
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="table", path=path + [name]))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        pinned = self.pinned_scope()
        remaining = list(path)
        dataset = pinned.get("dataset_id")
        if not dataset:
            if not remaining:
                return {}
            dataset = remaining.pop(0)
        if not remaining:
            return {}
        table_name = remaining[0]
        full_table = f"{self.project_id}.{dataset}.{table_name}"
        try:
            table_ref = self.client.get_table(full_table)
            columns = []
            for f in table_ref.schema:
                col: dict[str, Any] = {"name": f.name, "type": f.field_type}
                if f.description:
                    col["description"] = f.description
                columns.append(col)
            result: dict[str, Any] = {
                "row_count": table_ref.num_rows or 0,
                "columns": columns,
                "sample_rows": [],
            }
            if table_ref.description:
                result["description"] = table_ref.description
            return result
        except Exception as e:
            log.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            list(self.client.list_datasets(max_results=1))
            return True
        except Exception:
            return False
