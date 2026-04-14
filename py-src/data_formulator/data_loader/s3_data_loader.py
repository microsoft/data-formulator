import json
import logging
from typing import Any

import boto3
import pandas as pd
import pyarrow as pa
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq
from pyarrow import fs as pa_fs

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode

logger = logging.getLogger(__name__)


class S3DataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "aws_access_key_id", "type": "string", "required": True, "default": "", "description": "AWS access key ID"},
            {"name": "aws_secret_access_key", "type": "string", "required": True, "default": "", "description": "AWS secret access key"},
            {"name": "aws_session_token", "type": "string", "required": False, "default": "", "description": "AWS session token (required for temporary credentials)"},
            {"name": "region_name", "type": "string", "required": True, "default": "us-east-1", "description": "AWS region name"},
            {"name": "bucket", "type": "string", "required": True, "default": "", "description": "S3 bucket name"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** aws_access_key_id: `AKIA...` · aws_secret_access_key: `wJalr...` · region_name: `us-east-1` · bucket: `my-data-bucket`

**Getting credentials:** AWS Console → IAM → Users → Security credentials → Create access key → choose "Application running outside AWS".

**Required permissions:** `s3:GetObject` and `s3:ListBucket` on your bucket.

**Supported formats:** CSV, Parquet, JSON, JSONL"""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.aws_access_key_id = params.get("aws_access_key_id", "")
        self.aws_secret_access_key = params.get("aws_secret_access_key", "")
        self.aws_session_token = params.get("aws_session_token", "")
        self.region_name = params.get("region_name", "us-east-1")
        self.bucket = params.get("bucket", "")

        self.s3_fs = pa_fs.S3FileSystem(
            access_key=self.aws_access_key_id,
            secret_key=self.aws_secret_access_key,
            session_token=self.aws_session_token if self.aws_session_token else None,
            region=self.region_name,
        )
        logger.info(f"Initialized PyArrow S3 filesystem for bucket: {self.bucket}")

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        """
        Fetch data from S3 as a PyArrow Table using PyArrow's native S3 filesystem.
        
        For files (parquet, csv), reads directly using PyArrow.
        """
        opts = import_options or {}
        size = opts.get("size", 1000000)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")

        if not source_table:
            raise ValueError("source_table (S3 URL) must be provided")
        
        s3_url = source_table
        
        # Parse S3 URL: s3://bucket/key -> bucket/key for PyArrow
        if s3_url.startswith("s3://"):
            s3_path = s3_url[5:]  # Remove "s3://"
        else:
            s3_path = f"{self.bucket}/{s3_url}"
        
        logger.info(f"Reading S3 file via PyArrow: {s3_url}")
        
        # Read based on file extension
        if s3_url.lower().endswith('.parquet'):
            arrow_table = pq.read_table(s3_path, filesystem=self.s3_fs)
        elif s3_url.lower().endswith('.csv'):
            with self.s3_fs.open_input_file(s3_path) as f:
                arrow_table = pa_csv.read_csv(f)
        elif s3_url.lower().endswith('.json') or s3_url.lower().endswith('.jsonl'):
            import pyarrow.json as pa_json
            with self.s3_fs.open_input_file(s3_path) as f:
                arrow_table = pa_json.read_json(f)
        else:
            raise ValueError(f"Unsupported file type: {s3_url}")
        
        # Apply sorting if specified
        if sort_columns and len(sort_columns) > 0:
            df = arrow_table.to_pandas()
            ascending = sort_order != 'desc'
            df = df.sort_values(by=sort_columns, ascending=ascending)
            arrow_table = pa.Table.from_pandas(df, preserve_index=False)
        
        # Apply size limit
        if arrow_table.num_rows > size:
            arrow_table = arrow_table.slice(0, size)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from S3 [Arrow-native]")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List available files from S3 bucket."""
        s3_client = boto3.client(
            's3',
            aws_access_key_id=self.aws_access_key_id,
            aws_secret_access_key=self.aws_secret_access_key,
            aws_session_token=self.aws_session_token if self.aws_session_token else None,
            region_name=self.region_name
        )
        
        response = s3_client.list_objects_v2(Bucket=self.bucket)
        
        results = []
        
        if 'Contents' in response:
            for obj in response['Contents']:
                key = obj['Key']
                
                if key.endswith('/') or not self._is_supported_file(key):
                    continue
                
                if table_filter and table_filter.lower() not in key.lower():
                    continue
                
                s3_url = f"s3://{self.bucket}/{key}"
                
                try:
                    sample_table = self._read_sample_arrow(s3_url, 10)
                    sample_df = sample_table.to_pandas()
                    
                    columns = [{
                        'name': col,
                        'type': str(sample_df[col].dtype)
                    } for col in sample_df.columns]
                    
                    sample_rows = json.loads(sample_df.to_json(orient="records"))
                    row_count = self._estimate_row_count(s3_url)
                    
                    table_metadata = {
                        "row_count": row_count,
                        "columns": columns,
                        "sample_rows": sample_rows
                    }
                    
                    results.append({
                        "name": s3_url,
                        "metadata": table_metadata
                    })
                except Exception as e:
                    logger.warning(f"Error reading {s3_url}: {e}")
                    continue
        
        return results
    
    def _read_sample_arrow(self, s3_url: str, limit: int) -> pa.Table:
        """Read sample data using PyArrow S3 filesystem."""
        s3_path = s3_url[5:] if s3_url.startswith("s3://") else s3_url
        
        if s3_url.lower().endswith('.parquet'):
            table = pq.read_table(s3_path, filesystem=self.s3_fs)
        elif s3_url.lower().endswith('.csv'):
            with self.s3_fs.open_input_file(s3_path) as f:
                table = pa_csv.read_csv(f)
        elif s3_url.lower().endswith('.json') or s3_url.lower().endswith('.jsonl'):
            import pyarrow.json as pa_json
            with self.s3_fs.open_input_file(s3_path) as f:
                table = pa_json.read_json(f)
        else:
            raise ValueError(f"Unsupported file type: {s3_url}")
        
        return table.slice(0, limit) if table.num_rows > limit else table
    
    def _is_supported_file(self, key: str) -> bool:
        """Check if the file type is supported (CSV, Parquet, JSON)."""
        supported_extensions = [".csv", ".parquet", ".json", ".jsonl"]
        return any(key.lower().endswith(ext) for ext in supported_extensions)
    
    def _estimate_row_count(self, s3_url: str) -> int:
        """Estimate the number of rows in a file."""
        try:
            # For parquet files, use PyArrow metadata for exact count
            if s3_url.lower().endswith('.parquet'):
                s3_path = s3_url[5:] if s3_url.startswith("s3://") else s3_url
                parquet_file = pq.ParquetFile(s3_path, filesystem=self.s3_fs)
                return parquet_file.metadata.num_rows
            
            # For CSV, JSON, and JSONL files, skip row count for efficiency
            return 0
        except Exception as e:
            logger.warning(f"Error estimating row count for {s3_url}: {e}")
            return 0

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "bucket", "label": "Bucket"},
            {"key": "table", "label": "File"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "bucket":
            # Bucket is always pinned (required) but handle defensively
            return [CatalogNode(name=self.bucket, node_type="namespace", path=path + [self.bucket])]

        if level_key == "table":
            s3_client = boto3.client(
                "s3",
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                aws_session_token=self.aws_session_token if self.aws_session_token else None,
                region_name=self.region_name,
            )
            resp = s3_client.list_objects_v2(Bucket=self.bucket)
            nodes = []
            for obj in resp.get("Contents", []):
                key = obj["Key"]
                if key.endswith("/") or not self._is_supported_file(key):
                    continue
                if filter and filter.lower() not in key.lower():
                    continue
                nodes.append(CatalogNode(
                    name=key, node_type="table", path=path + [key],
                    metadata={"size_bytes": obj.get("Size", 0)},
                ))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        key = path[-1]
        s3_url = f"s3://{self.bucket}/{key}"
        try:
            sample = self._read_sample_arrow(s3_url, 5)
            sample_df = sample.to_pandas()
            columns = [{"name": c, "type": str(sample_df[c].dtype)} for c in sample_df.columns]
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            row_count = self._estimate_row_count(s3_url)
            return {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            s3_client = boto3.client(
                "s3",
                aws_access_key_id=self.aws_access_key_id,
                aws_secret_access_key=self.aws_secret_access_key,
                aws_session_token=self.aws_session_token if self.aws_session_token else None,
                region_name=self.region_name,
            )
            s3_client.head_bucket(Bucket=self.bucket)
            return True
        except Exception:
            return False