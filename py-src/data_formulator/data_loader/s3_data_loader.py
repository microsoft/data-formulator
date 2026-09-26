import logging
from typing import Any

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from pyarrow import fs as pa_fs

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS
from data_formulator.data_loader import probe_utils
from data_formulator.datalake.parquet_utils import df_to_safe_records

logger = logging.getLogger(__name__)


class S3DataLoader(ExternalDataLoader):
    DISPLAY_NAME = "Amazon S3"
    DESCRIPTION = "Load CSV, TSV, JSON, JSONL, or Parquet files from an Amazon S3 bucket."

    IDENTITY_PARAMS = ("bucket",)

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "aws_access_key_id", "type": "string", "required": True, "default": "", "sensitive": True, "tier": "auth", "description": "AWS access key ID"},
            {"name": "aws_secret_access_key", "type": "string", "required": True, "default": "", "sensitive": True, "tier": "auth", "description": "AWS secret access key"},
            {"name": "aws_session_token", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "AWS session token (required for temporary credentials)"},
            {"name": "region_name", "type": "string", "required": True, "default": "us-east-1", "tier": "connection", "description": "AWS region name"},
            {"name": "bucket", "type": "string", "required": True, "default": "", "tier": "connection", "description": "S3 bucket name"}
        ]
        return params_list

    @classmethod
    def auth_paths(cls) -> list[dict[str, Any]]:
        return [
            {
                "id": "access_keys",
                "label": "Access keys",
                "description": "Enter an AWS access key and secret. Temporary credentials also need a session token.",
                "fields": ["aws_access_key_id", "aws_secret_access_key", "aws_session_token"],
                "required_fields": ["aws_access_key_id", "aws_secret_access_key"],
                "kind": "credentials",
                "default": True,
            },
            {
                "id": "default_credentials",
                "label": "AWS default credentials",
                "description": "Use credentials from the environment or the host's IAM role.",
                "fields": [],
                "required_fields": [],
                "kind": "ambient",
            },
        ]

    @classmethod
    def infer_auth_path(cls, params: dict[str, Any]) -> str:
        if params.get("aws_access_key_id") or params.get("aws_secret_access_key"):
            return "access_keys"
        return "default_credentials"

    AUTH_GUIDE = "s3.md"
    QUERY_EXECUTION = "remote_file_scan"

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.aws_access_key_id = params.get("aws_access_key_id", "")
        self.aws_secret_access_key = params.get("aws_secret_access_key", "")
        self.aws_session_token = params.get("aws_session_token", "")
        self.region_name = params.get("region_name", "us-east-1")
        self.bucket = params.get("bucket", "")

        filesystem_args: dict[str, Any] = {"region": self.region_name}
        if self.aws_access_key_id and self.aws_secret_access_key:
            filesystem_args.update(
                access_key=self.aws_access_key_id,
                secret_key=self.aws_secret_access_key,
                session_token=self.aws_session_token or None,
            )
        self.s3_fs = pa_fs.S3FileSystem(**filesystem_args)
        logger.info(f"Initialized PyArrow S3 filesystem for bucket: {self.bucket}")

    def _source_url(self, source_table: str) -> str:
        if not source_table:
            raise ValueError("source_table (S3 URL) must be provided")
        source = source_table if source_table.startswith("s3://") else f"s3://{self.bucket}/{source_table}"
        if not source.startswith(f"s3://{self.bucket}/"):
            raise ValueError("Source must belong to the connected S3 bucket")
        return source

    def _s3_client(self):
        return boto3.client(
            "s3", aws_access_key_id=self.aws_access_key_id or None,
            aws_secret_access_key=self.aws_secret_access_key or None,
            aws_session_token=self.aws_session_token or None, region_name=self.region_name,
        )

    def _register_source(self, connection, source: str, *, preview: bool = False):
        scope = f"s3://{self.bucket}/"
        if self.aws_access_key_id and self.aws_secret_access_key:
            connection.execute(
                "CREATE SECRET s3_source (TYPE s3, KEY_ID ?, SECRET ?, SESSION_TOKEN ?, REGION ?, SCOPE ?)",
                [self.aws_access_key_id, self.aws_secret_access_key, self.aws_session_token,
                 self.region_name, scope],
            )
        else:
            connection.execute(
                "CREATE SECRET s3_source (TYPE s3, PROVIDER credential_chain, REGION ?, SCOPE ?)",
                [self.region_name, scope],
            )
        return probe_utils.register_file_scan(connection, source, preview=preview)

    def preview_data(self, source_table: str, import_options: dict[str, Any] | None = None,
                     *, purpose: str = "ui") -> dict[str, Any]:
        return probe_utils.preview_file(self._register_source, self._source_url(source_table), import_options, purpose=purpose)

    def query_data_as_arrow(self, source_table: str, query: dict[str, Any], limit: int) -> pa.Table:
        import duckdb

        source = self._source_url(source_table)
        extension = source.lower().rsplit(".", 1)[-1]
        if extension not in ("parquet", "csv", "tsv", "json", "jsonl"):
            raise ValueError(f"Unsupported file type: {source}")
        self._last_total_rows = None
        sql = probe_utils.compile_probe_sql(query, limit, dialect=probe_utils.DUCKDB)
        with duckdb.connect(config={"memory_limit": "512MB"}) as connection:
            self._register_source(connection, source)
            return connection.execute(sql).fetch_arrow_table()

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        opts = import_options or {}
        size = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)
        return self.query_data_as_arrow(source_table, probe_utils.query_from_import_options(opts), size)

    def probe(self, path: list[str], query: dict[str, Any]) -> dict[str, Any]:
        if not path:
            return {"error": "probe requires a non-empty table path"}
        source = path[-1] if path[-1].startswith("s3://") else "/".join(path)
        limit = probe_utils.clamp_probe_limit(query.get("limit"))
        try:
            result = self.query_data_as_arrow(source, query, limit)
            return probe_utils.shape_probe_payload(result, limit, exact=True,
                extra_note="Computed over the source, not a sample. Aggregates may scan the file.")
        except Exception as exc:
            return {"error": f"probe failed: {exc}"}

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """List supported object metadata without reading file contents."""
        results = []
        for page in self._s3_client().get_paginator("list_objects_v2").paginate(Bucket=self.bucket):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key.endswith("/") or not self._is_supported_file(key):
                    continue
                if table_filter and table_filter.lower() not in key.lower():
                    continue
                source = f"s3://{self.bucket}/{key}"
                results.append({"name": source, "path": [source],
                                "metadata": {"size_bytes": obj.get("Size", 0)}})
        return results
    
    def _read_sample_arrow(self, s3_url: str, limit: int) -> pa.Table:
        return self.fetch_data_as_arrow(s3_url, {"size": limit})
    
    def _is_supported_file(self, key: str) -> bool:
        """Check if the file type is supported."""
        supported_extensions = [".csv", ".tsv", ".parquet", ".json", ".jsonl"]
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
            nodes = []
            for table in self.list_tables(filter):
                key = table["name"][len(f"s3://{self.bucket}/"):]
                nodes.append(CatalogNode(
                    name=key, node_type="table", path=path + [key],
                    metadata=table["metadata"],
                ))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        try:
            key = path[-1] if path[-1].startswith("s3://") else "/".join(path)
            s3_url = self._source_url(key)
            if s3_url.lower().endswith('.parquet'):
                with pq.ParquetFile(s3_url[5:], filesystem=self.s3_fs) as source:
                    return {
                        "columns": [{"name": field.name, "type": str(field.type)} for field in source.schema_arrow],
                        "row_count": source.metadata.num_rows,
                        "inspection": {"schema_source": "footer", "row_count_status": "exact", "sample_status": "not_requested"},
                    }
                preview = self.preview_data(s3_url, purpose="agent")
                return {"columns": preview["columns"], "sample_rows": preview["rows"],
                    "inspection": preview["inspection"]}
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self._s3_client().head_bucket(Bucket=self.bucket)
            return True
        except Exception:
            return False