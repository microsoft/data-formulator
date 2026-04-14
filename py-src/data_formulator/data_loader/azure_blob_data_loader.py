import json
import logging
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.csv as pa_csv
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential
from pyarrow import fs as pa_fs

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, sanitize_table_name
from typing import Any

logger = logging.getLogger(__name__)

class AzureBlobDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "account_name", "type": "string", "required": True, "default": "", "description": "Azure storage account name"},
            {"name": "container_name", "type": "string", "required": True, "default": "", "description": "Azure blob container name"},
            {"name": "connection_string", "type": "string", "required": False, "default": "", "description": "Azure storage connection string (alternative to account_name + credentials)"},
            {"name": "credential_chain", "type": "string", "required": False, "default": "cli;managed_identity;env", "description": "Ordered list of Azure credential providers (cli;managed_identity;env)"},
            {"name": "account_key", "type": "string", "required": False, "default": "", "description": "Azure storage account key"},
            {"name": "sas_token", "type": "string", "required": False, "default": "", "description": "Azure SAS token"},
            {"name": "endpoint", "type": "string", "required": False, "default": "blob.core.windows.net", "description": "Azure endpoint override"}
        ]
        return params_list
    
    @staticmethod
    def auth_instructions() -> str:
        return """**Example (conn string):** connection_string: `DefaultEndpointsProtocol=https;AccountName=...` · container_name: `mydata`

**Example (account key):** account_name: `mystorageacct` · container_name: `mydata` · account_key: `abc123...`

**Option 1 — Connection String (simplest):**
Get it from Azure Portal → Storage Account → Access keys. Enter in `connection_string`; `account_name` can be omitted.

**Option 2 — Account Key:**
From Azure Portal → Storage Account → Access keys. Use `account_name` + `account_key`.

**Option 3 — SAS Token (recommended for limited access):**
Generate from Azure Portal → Storage Account → Shared access signature. Use `account_name` + `sas_token`. Can be time-limited and permission-scoped.

**Option 4 — Azure CLI / Managed Identity (most secure):**
Just provide `account_name` + `container_name`. Requires `az login` or Managed Identity.

**Supported formats:** CSV, Parquet, JSON, JSONL"""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        # Extract parameters
        self.account_name = params.get("account_name", "")
        self.container_name = params.get("container_name", "")
        self.connection_string = params.get("connection_string", "")
        self.credential_chain = params.get("credential_chain", "cli;managed_identity;env")
        self.account_key = params.get("account_key", "")
        self.sas_token = params.get("sas_token", "")
        self.endpoint = params.get("endpoint", "blob.core.windows.net")
        
        # Setup PyArrow Azure filesystem
        if self.account_key:
            self.azure_fs = pa_fs.AzureFileSystem(
                account_name=self.account_name,
                account_key=self.account_key
            )
        elif self.connection_string:
            self.azure_fs = pa_fs.AzureFileSystem.from_connection_string(self.connection_string)
        else:
            # Use default credential chain
            self.azure_fs = pa_fs.AzureFileSystem(account_name=self.account_name)
        
        logger.info(f"Initialized PyArrow Azure filesystem for account: {self.account_name}")

    def _azure_path(self, azure_url: str) -> str:
        """Convert Azure URL to path for PyArrow (container/blob)."""
        if azure_url.startswith("az://"):
            parts = azure_url[5:].split("/", 1)
            return parts[1] if len(parts) > 1 else azure_url
        return f"{self.container_name}/{azure_url}"

    def _read_sample(self, azure_url: str, limit: int) -> pd.DataFrame:
        """Read sample rows from an Azure blob using PyArrow. Returns a pandas DataFrame."""
        azure_path = self._azure_path(azure_url)
        if azure_url.lower().endswith('.parquet'):
            table = pq.read_table(azure_path, filesystem=self.azure_fs)
        elif azure_url.lower().endswith('.csv'):
            with self.azure_fs.open_input_file(azure_path) as f:
                table = pa_csv.read_csv(f)
        elif azure_url.lower().endswith('.json') or azure_url.lower().endswith('.jsonl'):
            import pyarrow.json as pa_json
            with self.azure_fs.open_input_file(azure_path) as f:
                table = pa_json.read_json(f)
        else:
            raise ValueError(f"Unsupported file type: {azure_url}")
        if table.num_rows > limit:
            table = table.slice(0, limit)
        return table.to_pandas()

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from Azure Blob as a PyArrow Table.
        
        For files (parquet, csv), reads directly using PyArrow's Azure filesystem.
        """
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

        if not source_table:
            raise ValueError("source_table (Azure blob URL) must be provided")
        
        azure_url = source_table
        azure_path = self._azure_path(azure_url)

        logger.info("Reading Azure blob via PyArrow: %s", azure_url)
        
        if azure_url.lower().endswith('.parquet'):
            arrow_table = pq.read_table(azure_path, filesystem=self.azure_fs)
        elif azure_url.lower().endswith('.csv'):
            with self.azure_fs.open_input_file(azure_path) as f:
                arrow_table = pa_csv.read_csv(f)
        elif azure_url.lower().endswith('.json') or azure_url.lower().endswith('.jsonl'):
            import pyarrow.json as pa_json
            with self.azure_fs.open_input_file(azure_path) as f:
                arrow_table = pa_json.read_json(f)
        else:
            raise ValueError(f"Unsupported file type: {azure_url}")
        
        # Apply sorting if specified
        if sort_columns and len(sort_columns) > 0:
            df = arrow_table.to_pandas()
            ascending = sort_order != 'desc'
            df = df.sort_values(by=sort_columns, ascending=ascending)
            arrow_table = pa.Table.from_pandas(df, preserve_index=False)
        
        # Apply size limit
        if arrow_table.num_rows > size:
            arrow_table = arrow_table.slice(0, size)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from Azure Blob [Arrow-native]")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        # Create blob service client based on authentication method
        if self.connection_string:
            blob_service_client = BlobServiceClient.from_connection_string(self.connection_string)
        elif self.account_key:
            blob_service_client = BlobServiceClient(
                account_url=f"https://{self.account_name}.{self.endpoint}",
                credential=self.account_key
            )
        elif self.sas_token:
            blob_service_client = BlobServiceClient(
                account_url=f"https://{self.account_name}.{self.endpoint}",
                credential=self.sas_token
            )
        else:
            # Use default credential chain
            from azure.identity import DefaultAzureCredential
            credential = DefaultAzureCredential()
            blob_service_client = BlobServiceClient(
                account_url=f"https://{self.account_name}.{self.endpoint}",
                credential=credential
            )
        
        container_client = blob_service_client.get_container_client(self.container_name)
        
        # List blobs in the container
        blob_list = container_client.list_blobs()        
        results = []
        
        for blob in blob_list:
            blob_name = blob.name
            
            # Skip directories and non-data files
            if blob_name.endswith('/') or not self._is_supported_file(blob_name):
                continue
            
            # Apply table filter if provided
            if table_filter and table_filter.lower() not in blob_name.lower():
                continue
            
            # Create Azure blob URL
            azure_url = f"az://{self.account_name}.{self.endpoint}/{self.container_name}/{blob_name}"
            
            try:
                sample_df = self._read_sample(azure_url, 10)

                columns = [{
                    'name': col,
                    'type': str(sample_df[col].dtype)
                } for col in sample_df.columns]

                sample_rows = json.loads(sample_df.to_json(orient="records"))
                row_count = self._estimate_row_count(azure_url, blob)

                table_metadata = {
                    "row_count": row_count,
                    "columns": columns,
                    "sample_rows": sample_rows
                }

                results.append({
                    "name": azure_url,
                    "metadata": table_metadata
                })
            except Exception as e:
                logger.warning("Error reading %s: %s", azure_url, e)
                continue
        
        return results
    
    def _is_supported_file(self, blob_name: str) -> bool:
        """Check if the file type is supported (PyArrow can read it)."""
        supported_extensions = ['.csv', '.parquet', '.json', '.jsonl']
        return any(blob_name.lower().endswith(ext) for ext in supported_extensions)

    def _estimate_row_count(self, azure_url: str, blob_properties=None) -> int:
        """Estimate the number of rows in a file."""
        try:
            file_extension = azure_url.lower().split('.')[-1]

            if file_extension == 'parquet':
                try:
                    azure_path = self._azure_path(azure_url)
                    pf = pq.ParquetFile(azure_path, filesystem=self.azure_fs)
                    return pf.metadata.num_rows
                except Exception as e:
                    logger.debug("Failed to get parquet row count for %s: %s", azure_url, e)
                    return 0

            if file_extension in ['csv', 'json', 'jsonl']:
                return self._estimate_rows_by_sampling(azure_url, blob_properties, file_extension)

            return 0
        except Exception as e:
            logger.warning("Error estimating row count for %s: %s", azure_url, e)
            return 0

    def _estimate_rows_by_sampling(self, azure_url: str, blob_properties, file_extension: str) -> int:
        """Estimate row count for text-based files using PyArrow sampling."""
        try:
            file_size_bytes = None
            if blob_properties and hasattr(blob_properties, 'size'):
                file_size_bytes = blob_properties.size

            if file_size_bytes is None:
                return self._estimate_by_row_sampling(azure_url, file_extension)

            sample_size = min(10000, max(1000, file_size_bytes // 100))
            try:
                sample_df = self._read_sample(azure_url, sample_size)
                sample_rows = len(sample_df)
                if sample_rows == 0:
                    return 0
                if sample_rows < sample_size:
                    return sample_rows

                min_bytes_per_row = 50 if file_extension == 'csv' else 100
                estimated_total_rows = int(file_size_bytes / max(file_size_bytes / sample_rows, min_bytes_per_row))
                estimated_total_rows = max(sample_rows, min(estimated_total_rows, file_size_bytes // 10))
                return estimated_total_rows
            except Exception as e:
                logger.debug("Size-based estimation failed for %s: %s", azure_url, e)
                return self._estimate_by_row_sampling(azure_url, file_extension)
        except Exception as e:
            logger.warning("Error in sampling estimation for %s: %s", azure_url, e)
            return 0

    def _estimate_by_row_sampling(self, azure_url: str, file_extension: str) -> int:
        """Estimate row count by reading a capped sample with PyArrow."""
        try:
            test_limit = 50000
            sample_df = self._read_sample(azure_url, test_limit)
            return len(sample_df)
        except Exception as e:
            logger.debug("Row sampling failed for %s: %s", azure_url, e)
            return 0

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "container_name", "label": "Container"},
            {"key": "table", "label": "File"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "container_name":
            return [CatalogNode(name=self.container_name, node_type="namespace", path=path + [self.container_name])]

        if level_key == "table":
            from azure.storage.blob import BlobServiceClient as _BSC
            if self.connection_string:
                bsc = _BSC.from_connection_string(self.connection_string)
            elif self.account_key:
                bsc = _BSC(account_url=f"https://{self.account_name}.{self.endpoint}", credential=self.account_key)
            else:
                from azure.identity import DefaultAzureCredential
                bsc = _BSC(account_url=f"https://{self.account_name}.{self.endpoint}", credential=DefaultAzureCredential())
            container_client = bsc.get_container_client(self.container_name)
            nodes = []
            for blob in container_client.list_blobs():
                name = blob.name
                if name.endswith("/") or not self._is_supported_file(name):
                    continue
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(
                    name=name, node_type="table", path=path + [name],
                    metadata={"size_bytes": blob.size if hasattr(blob, "size") else 0},
                ))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        blob_name = path[-1]
        azure_url = f"az://{self.account_name}.{self.endpoint}/{self.container_name}/{blob_name}"
        try:
            sample_df = self._read_sample(azure_url, 5)
            columns = [{"name": c, "type": str(sample_df[c].dtype)} for c in sample_df.columns]
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            row_count = self._estimate_row_count(azure_url)
            return {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            from azure.storage.blob import BlobServiceClient as _BSC
            if self.connection_string:
                bsc = _BSC.from_connection_string(self.connection_string)
            elif self.account_key:
                bsc = _BSC(account_url=f"https://{self.account_name}.{self.endpoint}", credential=self.account_key)
            else:
                from azure.identity import DefaultAzureCredential
                bsc = _BSC(account_url=f"https://{self.account_name}.{self.endpoint}", credential=DefaultAzureCredential())
            bsc.get_container_client(self.container_name).get_container_properties()
            return True
        except Exception:
            return False