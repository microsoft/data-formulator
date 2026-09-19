import json
import logging
from urllib.parse import urlsplit
import pandas as pd
import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq
import pyarrow.dataset as pa_dataset
from azure.storage.blob import BlobServiceClient, ExponentialRetry
from azure.identity import DefaultAzureCredential
from pyarrow import fs as pa_fs

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from data_formulator.data_loader import probe_utils
from data_formulator.datalake.parquet_utils import df_to_safe_records
from typing import Any

logger = logging.getLogger(__name__)

class AzureBlobDataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Azure Blob"
    DESCRIPTION = "Load CSV, JSON, or Parquet files from an Azure Blob Storage container."

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "account_name", "type": "string", "required": True, "default": "", "tier": "connection", "description": "Azure storage account name"},
            {"name": "container_name", "type": "string", "required": True, "default": "", "tier": "connection", "description": "Azure blob container name"},
            {"name": "connection_string", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "Azure storage connection string (alternative to account_name + credentials)"},
            {"name": "credential_chain", "type": "string", "required": False, "default": "cli;managed_identity;env", "tier": "auth", "description": "Ordered list of Azure credential providers (cli;managed_identity;env)"},
            {"name": "account_key", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "Azure storage account key"},
            {"name": "sas_token", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "Azure SAS token"},
            {"name": "endpoint", "type": "string", "required": False, "default": "blob.core.windows.net", "tier": "connection", "advanced": True, "description": "Blob endpoint suffix or full HTTPS account URL"}
        ]
        return params_list

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {
                "id": "azure_identity",
                "label": "Azure identity",
                "description": "Use Azure CLI credentials locally or a managed identity in Azure.",
                "fields": [],
                "required_fields": [],
                "kind": "ambient",
                "default": True,
            },
            {
                "id": "sas_token",
                "label": "SAS token",
                "description": "Use a time-limited SAS token scoped to the container.",
                "fields": ["sas_token"],
                "required_fields": ["sas_token"],
                "kind": "credentials",
            },
            {
                "id": "connection_string",
                "label": "Connection string",
                "description": "Use a storage account connection string.",
                "fields": ["connection_string"],
                "required_fields": ["connection_string"],
                "kind": "credentials",
            },
            {
                "id": "account_key",
                "label": "Account key",
                "description": "Use the storage account key.",
                "fields": ["account_key"],
                "required_fields": ["account_key"],
                "kind": "credentials",
            },
        ]

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        for field in ("sas_token", "connection_string", "account_key"):
            if params.get(field):
                return field
        return "azure_identity"
    
    AUTH_GUIDE = "azure_blob.md"
    QUERY_EXECUTION = "remote_file_scan"

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
        endpoint = str(self.endpoint or "blob.core.windows.net").strip() or "blob.core.windows.net"
        parsed = urlsplit(endpoint if "://" in endpoint else f"https://{endpoint}")
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or parsed.port is not None or any(character.isspace() for character in parsed.netloc)):
            raise ValueError("Blob endpoint must be a host suffix or HTTPS account URL without a path, credentials, or query.")
        host = parsed.hostname
        if "://" not in endpoint and not host.startswith(f"{self.account_name}."):
            host = f"{self.account_name}.{host}"
        self.account_url = f"https://{host}"
        self.blob_host = host
        blob_authority = host[len(self.account_name):] if host.startswith(f"{self.account_name}.") else host
        filesystem_endpoints = {"blob_storage_authority": blob_authority,
                    "dfs_storage_authority": blob_authority.replace(".blob.", ".dfs.", 1)}
        
        # Setup PyArrow Azure filesystem
        if self.account_key:
            self.azure_fs = pa_fs.AzureFileSystem(
                account_name=self.account_name,
                account_key=self.account_key,
                **filesystem_endpoints,
            )
        elif self.sas_token:
            self.azure_fs = pa_fs.AzureFileSystem(
                account_name=self.account_name,
                sas_token=self.sas_token,
                **filesystem_endpoints,
            )
        elif self.connection_string:
            self.azure_fs = pa_fs.AzureFileSystem.from_connection_string(self.connection_string)
        else:
            # Use default credential chain
            self.azure_fs = pa_fs.AzureFileSystem(account_name=self.account_name, **filesystem_endpoints)
        
        logger.info(f"Initialized PyArrow Azure filesystem for account: {self.account_name}")

    def _blob_service_client(self):
        options = {
            "connection_timeout": 5,
            "read_timeout": 10,
            "retry_policy": ExponentialRetry(initial_backoff=1, increment_base=2, retry_total=2, random_jitter_range=1),
        }
        if self.connection_string:
            return BlobServiceClient.from_connection_string(self.connection_string, **options)
        credential = self.account_key or self.sas_token or DefaultAzureCredential()
        return BlobServiceClient(account_url=self.account_url, credential=credential, **options)

    def _azure_path(self, azure_url: str) -> str:
        """Convert Azure URL to path for PyArrow (container/blob)."""
        if azure_url.startswith("az://"):
            parts = azure_url[5:].split("/", 1)
            return parts[1] if len(parts) > 1 else azure_url
        return f"{self.container_name}/{azure_url}"

    def _read_sample(self, azure_url: str, limit: int) -> pd.DataFrame:
        return self.fetch_data_as_arrow(azure_url, {"size": limit}).to_pandas()

    def _query_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        import duckdb

        extension = source_table.lower().rsplit('.', 1)[-1]
        formats = {"parquet": "parquet", "csv": "csv", "json": "json", "jsonl": "json"}
        if extension not in formats:
            raise ValueError(f"Unsupported file type: {source_table}")
        file_format = (
            pa_dataset.CsvFileFormat(parse_options=pa_csv.ParseOptions(newlines_in_values=True))
            if extension == "csv" else formats[extension]
        )
        dataset = pa_dataset.dataset(
            self._azure_path(source_table), filesystem=self.azure_fs, format=file_format,
        )
        scanner = dataset.scanner(batch_size=8192, batch_readahead=1, fragment_readahead=1, use_threads=True)
        sql = probe_utils.compile_probe_sql(query, limit, dialect=probe_utils.DUCKDB)
        with scanner.to_reader() as reader, duckdb.connect(config={"memory_limit": "512MB"}) as connection:
            connection.register("t", reader)
            return connection.execute(sql).fetch_arrow_table()

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        opts = import_options or {}
        size = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)
        if not source_table:
            raise ValueError("source_table (Azure blob URL) must be provided")
        source_filters = opts.get("source_filters") or []
        normalized_filters = probe_utils.probe_filters_to_source_filters(source_filters)
        if len(normalized_filters) != len(source_filters):
            raise ValueError("Unsupported source filter operator")
        filters = [{"column": item["column"], "op": item["operator"], "value": item.get("value")}
               for item in normalized_filters]
        return self._query_arrow(source_table, {
            "filters": filters, "columns": opts.get("columns") or [],
            "order_by": [{"column": column, "dir": opts.get("sort_order", "asc")}
                         for column in opts.get("sort_columns") or []],
        }, size)

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        source_table = path[-1] if path[-1].startswith("az://") else f"az://{self.blob_host}/{self.container_name}/{'/'.join(path)}"
        limit = probe_utils.clamp_probe_limit(query.get("limit"))
        try:
            result = self._query_arrow(source_table, query, limit)
            return probe_utils.shape_probe_payload(result, limit, exact=True,
                extra_note="Computed over the source, not a sample. Filters, sorting, and aggregates may scan the blob.")
        except Exception as exc:
            return {"error": f"probe failed: {exc}"}

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List supported blobs without downloading contents or inferring schemas."""
        blob_service_client = self._blob_service_client()
        
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
            azure_url = f"az://{self.blob_host}/{self.container_name}/{blob_name}"
            
            results.append({
                "name": azure_url,
                "path": [azure_url],
                "metadata": {"size_bytes": blob.size},
            })
        
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
            bsc = self._blob_service_client()
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
        blob_name = '/'.join(path)
        azure_url = path[-1] if path[-1].startswith("az://") else f"az://{self.blob_host}/{self.container_name}/{blob_name}"
        try:
            sample_df = self._read_sample(azure_url, 5)
            columns = [{"name": c, "type": str(sample_df[c].dtype)} for c in sample_df.columns]
            sample_rows = df_to_safe_records(sample_df)
            metadata = {"columns": columns, "sample_rows": sample_rows}
            if azure_url.lower().endswith('.parquet'):
                metadata["row_count"] = pq.ParquetFile(
                    self._azure_path(azure_url), filesystem=self.azure_fs,
                ).metadata.num_rows
            return metadata
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        bsc = self._blob_service_client()
        bsc.get_container_client(self.container_name).get_container_properties()
        return True