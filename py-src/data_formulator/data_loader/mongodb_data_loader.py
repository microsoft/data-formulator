import json
import logging
from datetime import datetime

import pandas as pd
import pyarrow as pa
import pymongo
from bson import ObjectId

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, CatalogNode, MAX_IMPORT_ROWS, sanitize_table_name
from typing import Any

logger = logging.getLogger(__name__)


class MongoDBDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
        params_list = [
            {"name": "host", "type": "string", "required": True, "default": "localhost", "tier": "connection", "description": "server address"}, 
            {"name": "port", "type": "int", "required": False, "default": 27017, "tier": "connection", "description": "server port"},
            {"name": "username", "type": "string", "required": False, "default": "", "tier": "auth", "description": "leave blank if no auth"},
            {"name": "password", "type": "string", "required": False, "default": "", "sensitive": True, "tier": "auth", "description": "leave blank if no auth"},
            {"name": "database", "type": "string", "required": True, "default": "", "tier": "connection", "description": "database name"},
            {"name": "collection", "type": "string", "required": False, "default": "", "tier": "filter", "description": "leave empty to list all collections"},
            {"name": "authSource", "type": "string", "required": False, "default": "", "tier": "auth", "description": "auth database (defaults to target database)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """**Example:** host: `localhost` · port: `27017` · database: `mydb` · collection: `users`

**Local setup:** Ensure MongoDB is running. Leave username and password blank if authentication is not enabled.

**Remote setup:** Get host, port, username, and password from your database administrator.

**Troubleshooting:** Test with `mongosh --host <host> --port <port>`"""

    def __init__(self, params: dict[str, Any]):
        self.params = params

        self.host = self.params.get("host", "localhost")
        self.port = int(self.params.get("port", 27017))
        self.username = self.params.get("username", "")
        self.password = self.params.get("password", "")
        self.database_name = self.params.get("database", "")
        self.collection_name = self.params.get("collection", "")
        auth_source = self.params.get("authSource", "") or self.database_name

        try:
            if self.username and self.password:
                self.mongo_client = pymongo.MongoClient(
                    host=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    authSource=auth_source
                )
            else:
                self.mongo_client = pymongo.MongoClient(host=self.host, port=self.port)

            self.db = self.mongo_client[self.database_name]
            self.collection = self.db[self.collection_name] if self.collection_name else None

            logger.info(f"Successfully connected to MongoDB: {self.host}:{self.port}/{self.database_name}")

        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise RuntimeError(f"Failed to connect to MongoDB: {e}") from e
    
    def close(self):
        """Close the MongoDB connection."""
        if hasattr(self, 'mongo_client') and self.mongo_client is not None:
            try:
                self.mongo_client.close()
                self.mongo_client = None
            except Exception as e:
                logger.warning(f"Failed to close MongoDB connection: {e}")

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
        Use recursion to flatten nested MongoDB documents
        """
        items = []
        for key, value in doc.items():
            new_key = f"{parent_key}{sep}{key}" if parent_key else key
            
            if isinstance(value, dict):
                items.extend(MongoDBDataLoader._flatten_document(value, new_key, sep).items())
            elif isinstance(value, list):
                if len(value) == 0:
                    items.append((new_key, None))
                else:
                    for idx, item in enumerate(value, start=1):
                        item_key = f"{new_key}{sep}{idx}"
                        if isinstance(item, dict):
                            items.extend(MongoDBDataLoader._flatten_document(item, item_key, sep).items())
                        else:
                            items.append((item_key, item))
            else:
                items.append((new_key, value))
        
        return dict(items)
    
    @staticmethod
    def _convert_special_types(doc: dict[str, Any]) -> dict[str, Any]:
        """
        Convert MongoDB special types (ObjectId, datetime, etc.) to serializable types
        """
        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, bytes):
                result[key] = value.decode('utf-8', errors='ignore')
            elif isinstance(value, dict):
                result[key] = MongoDBDataLoader._convert_special_types(value)
            elif isinstance(value, list):
                result[key] = [
                    MongoDBDataLoader._convert_special_types(item) if isinstance(item, dict)
                    else str(item) if isinstance(item, ObjectId)
                    else item.isoformat() if isinstance(item, datetime)
                    else item
                    for item in value
                ]
            else:
                result[key] = value
        return result
    
    def _process_documents(self, documents: list[dict[str, Any]]) -> pd.DataFrame:
        """
        Process MongoDB documents list, flatten and convert to DataFrame
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
        Fetch data from MongoDB as a PyArrow Table.
        
        MongoDB doesn't have native Arrow support, so we fetch documents,
        process them, and convert to Arrow format.
        
        Args:
            source_table: Collection name to fetch from
            size: Maximum number of documents to fetch
            sort_columns: Columns to sort by
            sort_order: Sort direction ('asc' or 'desc')
        """
        if not source_table:
            raise ValueError("source_table (collection name) must be provided")
        
        # Get collection
        collection_name = source_table
        # Handle full table names like "database.collection"
        if '.' in collection_name:
            parts = collection_name.split('.')
            collection_name = parts[-1]
        
        collection = self.db[collection_name]
        
        logger.info(f"Fetching from MongoDB collection: {collection_name}")
        
        # Build cursor with optional sorting
        data_cursor = collection.find()
        if sort_columns and len(sort_columns) > 0:
            sort_direction = -1 if sort_order == 'desc' else 1
            sort_spec = [(col, sort_direction) for col in sort_columns]
            data_cursor = data_cursor.sort(sort_spec)
        data_cursor = data_cursor.limit(size)
        
        # Fetch and process documents
        data_list = list(data_cursor)
        if not data_list:
            logger.warning(f"No data found in MongoDB collection '{collection_name}'")
            return pa.table({})
        
        df = self._process_documents(data_list)
        
        # Convert to Arrow
        arrow_table = pa.Table.from_pandas(df, preserve_index=False)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from MongoDB collection '{collection_name}'")
        
        return arrow_table
        
    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
        """
        List all collections
        """
        results = []
        
        # Get specified collection or all collections
        collection_param = self.params.get("collection", "")
        
        if collection_param:
            collection_names = [collection_param]
        else:
            collection_names = self.db.list_collection_names()
        
        for collection_name in collection_names:
            # Apply filter
            if table_filter and table_filter.lower() not in collection_name.lower():
                continue
            
            try:
                full_table_name = f"{collection_name}"
                collection = self.db[collection_name]
                
                # Get row count
                row_count = collection.count_documents({})
                
                # Get sample data
                sample_data = list(collection.find().limit(10))
                
                if sample_data:
                    df = self._process_documents(sample_data)
                    
                    # Construct column information
                    columns = [{
                        'name': col,
                        'type': str(df[col].dtype)
                    } for col in df.columns]
                    
                    # Convert sample_data for return
                    sample_rows = json.loads(df.to_json(orient="records"))
                else:
                    columns = []
                    sample_rows = []
                
                table_metadata = {
                    "row_count": row_count,
                    "columns": columns,
                    "sample_rows": sample_rows
                }
                
                results.append({
                    "name": full_table_name,
                    "path": [collection_name],
                    "metadata": table_metadata
                })
            except Exception as e:
                logger.debug(f"Error listing collection {collection_name}: {e}")
                continue

        return results

    # -- Catalog tree API --------------------------------------------------

    @staticmethod
    def catalog_hierarchy() -> list[dict[str, str]]:
        return [
            {"key": "database", "label": "Database"},
            {"key": "collection", "label": "Collection"},
        ]

    def ls(self, path: list[str] | None = None, filter: str | None = None) -> list[CatalogNode]:
        path = path or []
        eff = self.effective_hierarchy()
        if len(path) >= len(eff):
            return []
        level_key = eff[len(path)]["key"]

        if level_key == "database":
            # database is required, so always pinned — but handle defensively
            return [CatalogNode(
                name=self.database_name, node_type="namespace",
                path=path + [self.database_name],
            )]

        if level_key == "collection":
            collection_names = self.db.list_collection_names()
            nodes = []
            for name in sorted(collection_names):
                if filter and filter.lower() not in name.lower():
                    continue
                nodes.append(CatalogNode(name=name, node_type="table", path=path + [name]))
            return nodes

        return []

    def get_metadata(self, path: list[str]) -> dict[str, Any]:
        if not path:
            return {}
        collection_name = path[-1]
        try:
            coll = self.db[collection_name]
            row_count = coll.count_documents({})
            sample = list(coll.find().limit(5))
            if sample:
                df = self._process_documents(sample)
                columns = [{"name": c, "type": str(df[c].dtype)} for c in df.columns]
                sample_rows = json.loads(df.to_json(orient="records"))
            else:
                columns, sample_rows = [], []
            return {"row_count": row_count, "columns": columns, "sample_rows": sample_rows}
        except Exception as e:
            logger.warning(f"get_metadata failed for {path}: {e}")
            return {}

    def test_connection(self) -> bool:
        try:
            self.mongo_client.admin.command("ping")
            return True
        except Exception:
            return False