import logging
from datetime import datetime

import pandas as pd
import pyarrow as pa

from azure.cosmos import CosmosClient, exceptions as cosmos_exceptions
from azure.cosmos.partition_key import PartitionKey

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from data_formulator.datalake.parquet_utils import df_to_safe_records
from typing import Any

logger = logging.getLogger(__name__)


class CosmosDBDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "endpoint", "type": "string", "required": True, "default": "https://localhost:8081", "tier": "connection", "description": "Cosmos DB account endpoint URL"},
            {"name": "key", "type": "string", "required": True, "default": "", "sensitive": True, "tier": "auth", "description": "account key or emulator key"},
            {"name": "database", "type": "string", "required": True, "default": "", "tier": "connection", "description": "database name"},
            {"name": "container", "type": "string", "required": False, "default": "", "tier": "filter", "description": "leave empty to list all containers"},
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** endpoint: `https://myaccount.documents.azure.com:443/` · database: `mydb`

**Azure setup:** Find your endpoint and key in the Azure Portal under *Keys* for your Cosmos DB account.

**Local emulator:** Use endpoint `https://localhost:8081` with the well-known emulator key.

**Troubleshooting:** Ensure the account firewall allows your IP, or use a connection from an allowed network."""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.endpoint = self.params.get("endpoint", "")
        self.key = self.params.get("key", "")
        self.database_name = self.params.get("database", "")
        self.container_name = self.params.get("container", "")

        if not self.endpoint:
            raise ValueError("Cosmos DB endpoint is required")
        if not self.key:
            raise ValueError("Cosmos DB key is required")
        if not self.database_name:
            raise ValueError("Cosmos DB database name is required")

        try:
            # Disable SSL verification for local emulator (self-signed cert)
            is_emulator = "localhost" in self.endpoint or "127.0.0.1" in self.endpoint
            connection_kwargs: dict[str, Any] = {}
            if is_emulator:
                import urllib3
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                connection_kwargs["connection_verify"] = False

            self.client = CosmosClient(
                url=self.endpoint,
                credential=self.key,
                **connection_kwargs,
            )
            self.db = self.client.get_database_client(self.database_name)
            # Verify database exists
            self.db.read()

            if self.container_name:
                self.container = self.db.get_container_client(self.container_name)
                self.container.read()
            else:
                self.container = None

            logger.info(f"Successfully connected to Cosmos DB: {self.endpoint}/{self.database_name}")

        except cosmos_exceptions.CosmosResourceNotFoundError as e:
            logger.error(f"Cosmos DB resource not found: {e}")
            raise RuntimeError(f"Cosmos DB resource not found: {e}") from e
        except Exception as e:
            logger.error(f"Failed to connect to Cosmos DB: {e}")
            raise RuntimeError(f"Failed to connect to Cosmos DB: {e}") from e

    def close(self):
        """Close the Cosmos DB connection."""
        if hasattr(self, 'client') and self.client is not None:
            self.client = None

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - ensures connection is closed"""
        self.close()
        return False

    def __del__(self):
        """Destructor to ensure connection is closed"""
        self.close()

    @staticmethod
    def _flatten_document(doc: dict[str, Any], parent_key: str = '', sep: str = '_') -> dict[str, Any]:
        """
        Use recursion to flatten nested Cosmos DB documents.
        Skips internal Cosmos metadata fields (_rid, _self, _etag, _attachments, _ts).
        """
        skip_keys = {'_rid', '_self', '_etag', '_attachments', '_ts'}
        items = []
        for key, value in doc.items():
            if key in skip_keys:
                continue
            new_key = f"{parent_key}{sep}{key}" if parent_key else key

            if isinstance(value, dict):
                items.extend(CosmosDBDataLoader._flatten_document(value, new_key, sep).items())
            elif isinstance(value, list):
                if len(value) == 0:
                    items.append((new_key, None))
                else:
                    for idx, item in enumerate(value, start=1):
                        item_key = f"{new_key}{sep}{idx}"
                        if isinstance(item, dict):
                            items.extend(CosmosDBDataLoader._flatten_document(item, item_key, sep).items())
                        else:
                            items.append((item_key, item))
            else:
                items.append((new_key, value))

        return dict(items)

    @staticmethod
    def _convert_special_types(doc: dict[str, Any]) -> dict[str, Any]:
        """
        Convert special types to serializable types.
        """
        result = {}
        for key, value in doc.items():
            if isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, bytes):
                result[key] = value.decode('utf-8', errors='ignore')
            elif isinstance(value, dict):
                result[key] = CosmosDBDataLoader._convert_special_types(value)
            elif isinstance(value, list):
                result[key] = [
                    CosmosDBDataLoader._convert_special_types(item) if isinstance(item, dict)
                    else item.isoformat() if isinstance(item, datetime)
                    else item
                    for item in value
                ]
            else:
                result[key] = value
        return result

    def _process_documents(self, documents: list[dict[str, Any]]) -> pd.DataFrame:
        """
        Process Cosmos DB documents, flatten and convert to DataFrame.
        """
        if not documents:
            return pd.DataFrame()

        processed_docs = []
        for doc in documents:
            converted = self._convert_special_types(doc)
            flattened = self._flatten_document(converted)
            processed_docs.append(flattened)

        df = pd.DataFrame(processed_docs)
        return df

    def fetch_data_as_arrow(
        self,
        source_table: str,
        import_options: dict[str, Any] | None = None,
    ) -> pa.Table:
        opts = import_options or {}
        size = min(opts.get("size", MAX_IMPORT_ROWS), MAX_IMPORT_ROWS)
        sort_columns = opts.get("sort_columns")
        sort_order = opts.get("sort_order", "asc")
        """
        Fetch data from Cosmos DB as a PyArrow Table.

        Cosmos DB NoSQL API returns JSON documents; we flatten and convert
        to Arrow format.

        Args:
            source_table: Container name to fetch from
            size: Maximum number of documents to fetch
            sort_columns: Columns to sort by (applied client-side)
            sort_order: Sort direction ('asc' or 'desc')
        """
        if not source_table:
            raise ValueError("source_table (container name) must be provided")

        container_name = source_table
        if '.' in container_name:
            parts = container_name.split('.')
            container_name = parts[-1]

        container = self.db.get_container_client(container_name)

        logger.info(f"Fetching from Cosmos DB container: {container_name}")

        # Query items with TOP to limit results
        query = f"SELECT TOP {int(size)} * FROM c"
        if sort_columns and len(sort_columns) > 0:
            direction = "DESC" if sort_order == "desc" else "ASC"
            order_parts = [f"c.{col} {direction}" for col in sort_columns]
            query += " ORDER BY " + ", ".join(order_parts)

        items = list(container.query_items(query=query, enable_cross_partition_query=True))

        if not items:
            logger.warning(f"No data found in Cosmos DB container '{container_name}'")
            return pa.table({})

        df = self._process_documents(items)

        arrow_table = pa.Table.from_pandas(df, preserve_index=False)

        logger.info(f"Fetched {arrow_table.num_rows} rows from Cosmos DB container '{container_name}'")

        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """
        List all containers in the database.
        """
        results = []

        container_param = self.params.get("container", "")

        if container_param:
            container_names = [container_param]
        else:
            container_names = [c["id"] for c in self.db.list_containers()]

        for container_name in container_names:
            if table_filter and table_filter.lower() not in container_name.lower():
                continue

            try:
                container = self.db.get_container_client(container_name)

                # Get row count (uses query since Cosmos has no count_documents)
                count_query = "SELECT VALUE COUNT(1) FROM c"
                row_count = list(container.query_items(
                    query=count_query, enable_cross_partition_query=True
                ))[0]

                # Get sample data
                sample_query = "SELECT TOP 10 * FROM c"
                sample_data = list(container.query_items(
                    query=sample_query, enable_cross_partition_query=True
                ))

                if sample_data:
                    df = self._process_documents(sample_data)

                    columns = [{
                        'name': col,
                        'type': str(df[col].dtype)
                    } for col in df.columns]

                    sample_rows = df_to_safe_records(df)
                else:
                    columns = []
                    sample_rows = []

                table_metadata = {
                    "row_count": row_count,
                    "columns": columns,
                    "sample_rows": sample_rows
                }

                results.append({
                    "name": container_name,
                    "path": [container_name],
                    "metadata": table_metadata
                })
            except Exception as e:
                logger.debug(f"Error listing container {container_name}: {e}")
                continue

        return results

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "container", "label": "Container"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "database":
            return [CatalogNode(
                name=self.database_name, node_type="namespace",
                path=path + [self.database_name],
            )]

        if level_key == "container":
            container_names = [c["id"] for c in self.db.list_containers()]
            nodes = []
            for name in sorted(container_names):
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="table", path=path + [name]))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        container_name = path[-1]
        try:
            container = self.db.get_container_client(container_name)
            count_query = "SELECT VALUE COUNT(1) FROM c"
            row_count = list(container.query_items(
                query=count_query, enable_cross_partition_query=True
            ))[0]
            sample_query = "SELECT TOP 5 * FROM c"
            sample = list(container.query_items(
                query=sample_query, enable_cross_partition_query=True
            ))
            if sample:
                df = self._process_documents(sample)
                columns = [{"name": c, "type": str(df[c].dtype)} for c in df.columns]
                sample_rows = df_to_safe_records(df)
            else:
                columns, sample_rows = [], []
            return {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self.db.read()
            return True
        except Exception:
            return False
