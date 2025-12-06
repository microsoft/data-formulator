import json
from typing import Dict, Any, Optional, List

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from data_formulator.data_loader.mongodb_query_parser import get_parser


class MongoDBDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list:
        return [
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": "MongoDB server address"},
            {"name": "port", "type": "int", "required": False, "default": 27017, "description": "MongoDB server port"},
            {"name": "user", "type": "string", "required": False, "default": "", "description": "Username (optional)"},
            {"name": "password", "type": "string", "required": False, "default": "", "description": "Password (optional)"},
            {"name": "database", "type": "string", "required": True, "default": "test", "description": "Database name"},
            {"name": "authSource", "type": "string", "required": False, "default": "admin", "description": "Auth database"}
        ]

    @staticmethod
    def auth_instructions() -> str:
        return """
MongoDB Connection Instructions:
1. Local MongoDB Setup:
    - Ensure MongoDB server is running on your machine
    - Default connection: host='localhost', port=27017
    - If you haven't set a username/password, leave those fields empty

2. Remote MongoDB Connection:
    - Obtain host address, port, username, and password from your database administrator
    - Ensure the MongoDB server allows remote connections
    - Check that your IP is whitelisted in MongoDB's user permissions

3. Common Connection Parameters:
    - host: Your MongoDB server address (default: 'localhost')
    - port: MongoDB server port (default: 27017)
    - user: Your MongoDB username (leave empty if not set)
    - password: Your MongoDB password (leave empty if not set)
    - database: Target database name to connect to
    - authSource: Authentication database

4. Example Query Formats:
    - Find documents: db.collection.find({filter}, {projection}, {options})
    - Aggregate: db.collection.aggregate([pipeline], {options})
    - Count documents: db.collection.countDocuments({filter})
    - Distinct values: db.collection.distinct("field", {filter})
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        self.database = params.get('database', 'test')
        self.parser = get_parser()
        
        host = params.get('host', 'localhost')
        port = params.get('port', 27017)
        user = params.get('user', '')
        password = params.get('password', '')
        auth_source = params.get('authSource', 'admin')
        
        if user and password:
            from urllib.parse import quote_plus
            uri = f"mongodb://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{self.database}?authSource={auth_source}"
        else:
            uri = f"mongodb://{host}:{port}/{self.database}"
        
        try:
            from pymongo import MongoClient
            self.client = MongoClient(uri, serverSelectionTimeoutMS=5000)
            self.db = self.client[self.database]
            self.client.server_info()
        except ImportError:
            raise ImportError("pymongo is required. Install with: pip install pymongo")
        except Exception as e:
            raise ConnectionError(f"Failed to connect to MongoDB: {e}")

    def _execute_query(self, parsed: Dict, preview: bool = True) -> List[Dict]:
        # Execute the parsed query
        collection_name = parsed['collection']
        method = parsed['method']
        
        if collection_name not in self.db.list_collection_names():
            raise ValueError(f"Collection '{collection_name}' not found")
        
        collection = self.db[collection_name]
        
        if method == 'find':
            return self._exec_find(collection, parsed, preview)
        
        elif method == 'findOne':
            return self._exec_find_one(collection, parsed)
        
        elif method == 'aggregate':
            return self._exec_aggregate(collection, parsed, preview)
        
        elif method == 'countDocuments':
            filter_query = parsed.get('filter', {})
            return [{"count": collection.count_documents(filter_query)}]
        
        elif method == 'estimatedDocumentCount':
            return [{"count": collection.estimated_document_count()}]
        
        elif method == 'distinct':
            return self._exec_distinct(collection, parsed)
        
        else:
            raise ValueError(f"Unsupported method: {method}")

    def _exec_find(self, collection, parsed: Dict, preview: bool) -> List[Dict]:
        # Execute find query
        filter_query = parsed.get('filter', {})
        projection = parsed.get('projection')
        options = parsed.get('options', {})
        
        cursor = collection.find(filter_query, projection)
        
        if options.get('sort'):
            sort_spec = options['sort']
            if isinstance(sort_spec, dict):
                cursor = cursor.sort(list(sort_spec.items()))
        
        if options.get('skip'):
            cursor = cursor.skip(options['skip'])

        limit = options.get('limit')
        if preview and limit is None:
            limit = 10 
        if limit:
            cursor = cursor.limit(limit)
        
        return [self._serialize(doc) for doc in cursor]

    def _exec_find_one(self, collection, parsed: Dict) -> List[Dict]:
        # Execute findOne query
        filter_query = parsed.get('filter', {})
        projection = parsed.get('projection')
        
        doc = collection.find_one(filter_query, projection)
        return [self._serialize(doc)] if doc else []

    def _exec_aggregate(self, collection, parsed: Dict, preview: bool) -> List[Dict]:
        # Execute aggregate query
        pipeline = parsed.get('pipeline', [])
        options = parsed.get('options', {})

        print(pipeline)
        
        if not isinstance(pipeline, list):
            raise ValueError("Aggregate pipeline must be a list")
        
        if preview:
            has_limit = any('$limit' in stage for stage in pipeline)
            if not has_limit:
                limit = options.get('limit', 10)
                pipeline = pipeline + [{'$limit': limit}]
        
        # Execute aggregate
        results = list(collection.aggregate(pipeline))
        return [self._serialize(doc) for doc in results]

    def _exec_distinct(self, collection, parsed: Dict) -> List[Dict]:
        # Execute distinct query
        field = parsed.get('field')
        filter_query = parsed.get('filter', {})
        
        if not field:
            raise ValueError("distinct requires a field name")
        
        values = collection.distinct(field, filter_query)
        return [{"field": field, "values": values, "count": len(values)}]

    def _serialize(self, doc: Any) -> Any:
        # Serialize MongoDB document to JSON-compatible format
        from bson import ObjectId
        from datetime import datetime
        
        if doc is None:
            return None
        
        if isinstance(doc, dict):
            return {str(k): self._serialize(v) for k, v in doc.items()}
        
        if isinstance(doc, list):
            return [self._serialize(item) for item in doc]
        
        if isinstance(doc, ObjectId):
            return str(doc)
        
        if isinstance(doc, datetime):
            return doc.isoformat()
        
        if isinstance(doc, bytes):
            return doc.hex()
        
        return doc

    def list_tables(self, table_filter: str = None) -> List[Dict]:
        # List collections and their metadata
        results = []
        
        for name in self.db.list_collection_names():
            if table_filter and table_filter.lower() not in name.lower():
                continue
            
            collection = self.db[name]
            sample_docs = list(collection.find().limit(5))
            
            all_keys = set()
            for doc in sample_docs:
                all_keys.update(self._flatten_keys(doc))
            
            columns = [{'name': k, 'type': self._infer_type(sample_docs, k)} for k in sorted(all_keys)]
            
            results.append({
                "name": name,
                "metadata": {
                    "row_count": collection.estimated_document_count(),
                    "columns": columns,
                    "sample_rows": [self._serialize(doc) for doc in sample_docs]
                }
            })
        
        return results

    def _flatten_keys(self, doc: Dict, prefix: str = '') -> set:
        # Flatten document keys
        keys = set()
        if not isinstance(doc, dict):
            return keys
        
        for k, v in doc.items():
            full_key = f"{prefix}.{k}" if prefix else str(k)
            if isinstance(v, dict) and not str(k).startswith('$'):
                keys.update(self._flatten_keys(v, full_key))
            else:
                keys.add(full_key)
        return keys

    def _infer_type(self, docs: List[Dict], key: str) -> str:
        # Infer field type
        from bson import ObjectId
        from datetime import datetime
        
        for doc in docs:
            value = doc
            for k in key.split('.'):
                value = value.get(k) if isinstance(value, dict) else None
                if value is None:
                    break
            
            if value is not None:
                if isinstance(value, bool): return 'boolean'
                if isinstance(value, int): return 'integer'
                if isinstance(value, float): return 'float'
                if isinstance(value, str): return 'string'
                if isinstance(value, datetime): return 'datetime'
                if isinstance(value, ObjectId): return 'objectid'
                if isinstance(value, list): return 'array'
                if isinstance(value, dict): return 'object'
        return 'unknown'

    def ingest_data(self, table_name: str, name_as: Optional[str] = None, size: int = 1000000):
        # Import collection into DuckDB
        docs = list(self.db[table_name].find().limit(size))
        if not docs:
            raise ValueError(f"Collection '{table_name}' is empty")
        
        df = pd.json_normalize([self._serialize(doc) for doc in docs])
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as or table_name))

    def view_query_sample(self, query: str) -> List[Dict]:
        # Preview query results
        query = query.strip()
        if not query:
            raise ValueError("Query cannot be empty")
        
        # Shell 风格: db.collection.method(...)
        if query.startswith('db.'):
            parsed = self.parser.parse(query)
            return self._execute_query(parsed, preview=True)
        
        # 直接使用集合名
        if query in self.db.list_collection_names():
            docs = list(self.db[query].find().limit(10))
            return [self._serialize(doc) for doc in docs]
        
        raise ValueError("Invalid query. Use: db.collection.find({...}) or db.collection.aggregate([...])")

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        # Execute query and import results into DuckDB
        query = query.strip()
        
        if query.startswith('db.'):
            parsed = self.parser.parse(query)
            docs = self._execute_query(parsed, preview=False)
        elif query in self.db.list_collection_names():
            docs = [self._serialize(doc) for doc in self.db[query].find()]
        else:
            raise ValueError(f"Invalid query: {query}")
        
        if not docs:
            raise ValueError("Query returned no results")
        
        flat_docs = []
        for doc in docs:
            flat_doc = {}
            for key, value in doc.items():
                if isinstance(value, (list, dict)):
                    flat_doc[key] = json.dumps(value, ensure_ascii=False)
                else:
                    flat_doc[key] = value
            flat_docs.append(flat_doc)
        
        df = pd.DataFrame(flat_docs)
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as))
        return df

    def __del__(self):
        if hasattr(self, 'client'):
            try:
                self.client.close()
            except:
                pass