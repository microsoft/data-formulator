import json
import string
import random as rand

import pandas as pd
import duckdb
import pymongo
from bson import ObjectId
from datetime import datetime

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Any


class MongoDBDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": ""}, 
            {"name": "port", "type": "int", "required": False, "default": 27017, "description": "MongoDB server port (default 27017)"},
            {"name": "username", "type": "string", "required": False, "default": "", "description": ""},
            {"name": "password", "type": "string", "required": False, "default": "", "description": ""},
            {"name": "database", "type": "string", "required": True, "default": "", "description": ""},
            {"name": "collection", "type": "string", "required": False, "default": "", "description": "If specified, only this collection will be accessed"},
            {"name": "authSource", "type": "string", "required": False, "default": "", "description": "Authentication database (defaults to target database if empty)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
MongoDB Connection Instructions:

1. Local MongoDB Setup:
   - Ensure MongoDB server is running on your machine
   - Default connection: host='localhost', port=27017
   - If authentication is not enabled, leave username and password empty

2. Remote MongoDB Connection:
   - Obtain host address, port, username, and password from your database administrator
   - Ensure the MongoDB server allows remote connections

3. Common Connection Parameters:
   - host: MongoDB server address (default: 'localhost')
   - port: MongoDB server port (default: 27017)
   - username: Your MongoDB username (leave empty if no auth)
   - password: Your MongoDB password (leave empty if no auth)
   - database: Target database name to connect to
   - collection: (Optional) Specific collection to access, leave empty to list all collections

4. Troubleshooting:
   - Verify MongoDB service is running: `mongod --version`
   - Test connection: `mongosh --host [host] --port [port]`
"""

    def __init__(self, params: dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        try:
            # Create MongoDB client
            host = self.params.get("host", "localhost")
            port = int(self.params.get("port", 27017))
            username = self.params.get("username", "")
            password = self.params.get("password", "")
            database = self.params.get("database", "")
            collection = self.params.get("collection", "")
            auth_source = self.params.get("authSource", "") or database  # Default to target database
            
            if username and password:
                # Use authSource to specify which database contains user credentials
                self.mongo_client = pymongo.MongoClient(
                    host=host, 
                    port=port, 
                    username=username, 
                    password=password,
                    authSource=auth_source
                )
            else:
                self.mongo_client = pymongo.MongoClient(host=host, port=port)
            
            self.db = self.mongo_client[database]
            self.database_name = database
            
            self.collection = self.db[collection] if collection else None
            
        except Exception as e:
            raise Exception(f"Failed to connect to MongoDB: {e}")
    
    def close(self):
        """Close the MongoDB connection"""
        if hasattr(self, 'mongo_client') and self.mongo_client is not None:
            try:
                self.mongo_client.close()
                self.mongo_client = None
            except Exception as e:
                print(f"Warning: Failed to close MongoDB connection: {e}")

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
        
    def list_tables(self, table_filter: str = None):
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
                    "metadata": table_metadata
                })
            except Exception as e:
                continue
        
        return results
    
    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 100000, sort_columns: list[str] | None = None, sort_order: str = 'asc'):
        """
        Import MongoDB collection data into DuckDB
        """
        # Extract collection name from full table name
        parts = table_name.split('.')
        if len(parts) >= 3:
            collection_name = parts[-1]
        else:
            collection_name = table_name
        
        if name_as is None:
            name_as = collection_name

        # Get and process data from MongoDB (limit rows)
        collection = self.db[collection_name]
        
        # Build cursor with optional sorting
        data_cursor = collection.find()
        if sort_columns and len(sort_columns) > 0:
            # MongoDB sort format: 1 for ascending, -1 for descending
            sort_direction = -1 if sort_order == 'desc' else 1
            sort_spec = [(col, sort_direction) for col in sort_columns]
            data_cursor = data_cursor.sort(sort_spec)
        data_cursor = data_cursor.limit(size)
        
        data_list = list(data_cursor)
        if not data_list:
            raise Exception(f"No data found in MongoDB collection '{collection_name}'.")
        df = self._process_documents(data_list)

        name_as = sanitize_table_name(name_as)

        self._load_dataframe_to_duckdb(df, name_as, size)
        return

    
    def view_query_sample(self, query: str) -> list[dict[str, Any]]:

        self._existed_collections_in_duckdb()
        self._difference_collections()
        self._preload_all_collections(self.collection.name if self.collection else "")

        result, error_message = validate_sql_query(query)
        if not result:
            print(error_message)
            raise ValueError(error_message)
        
        result_query = json.loads(self.duck_db_conn.execute(query).df().head(10).to_json(orient="records"))

        self._drop_all_loaded_tables()

        for collection_name, df in self.existed_collections.items():
            self._load_dataframe_to_duckdb(df, collection_name)

        return result_query
    
    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        """
        Create a new table from query results
        """
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)
        
        name_as = sanitize_table_name(name_as)

        self._existed_collections_in_duckdb()
        self._difference_collections()
        self._preload_all_collections(self.collection.name if self.collection else "")
        
        query_result_df = self.duck_db_conn.execute(query).df()

        self._drop_all_loaded_tables()

        for collection_name, existing_df in self.existed_collections.items():
            self._load_dataframe_to_duckdb(existing_df, collection_name)
        
        self._load_dataframe_to_duckdb(query_result_df, name_as)

        return query_result_df
    
    @staticmethod
    def _quote_identifier(name: str) -> str:
        """
        Safely quote a SQL identifier to prevent SQL injection.
        Double quotes are escaped by doubling them.
        """
        # Escape any double quotes in the identifier by doubling them
        escaped = name.replace('"', '""')
        return f'"{escaped}"'

    def _existed_collections_in_duckdb(self):
        """
        Return the names and contents of tables already loaded into DuckDB
        """
        self.existed_collections = {}
        duckdb_tables = self.duck_db_conn.execute("SHOW TABLES").df()
        for _, row in duckdb_tables.iterrows():
            collection_name = row['name']
            quoted_name = self._quote_identifier(collection_name)
            df = self.duck_db_conn.execute(f"SELECT * FROM {quoted_name}").df()
            self.existed_collections[collection_name] = df


    def _difference_collections(self):
        """
        Return the difference between all collections and loaded collections
        """
        self.diff_collections = []
        all_collections = set(self.db.list_collection_names())
        loaded_collections = set(self.existed_collections)
        diff_collections = all_collections - loaded_collections
        self.diff_collections = list(diff_collections)
        print(f'Difference collections: {self.diff_collections}')

    def _drop_all_loaded_tables(self):
        """
        Drop all tables loaded into DuckDB
        """
        for table_name in self.loaded_tables.values():
            try:
                quoted_name = self._quote_identifier(table_name)
                self.duck_db_conn.execute(f"DROP TABLE IF EXISTS main.{quoted_name}")
                print(f"Dropped loaded table: {table_name}")
            except Exception as e:
                print(f"Warning: Failed to drop table '{table_name}': {e}")

    def _preload_all_collections(self, specified_collection: str = "", size: int = 100000):
        """
        Preload all MongoDB collections into DuckDB memory
        """
        # Get the list of collections to load
        if specified_collection:
            collection_names = [specified_collection]
        else:
            collection_names = self.db.list_collection_names()
        
        # Record loaded tables
        self.loaded_tables = {}
        
        for collection_name in collection_names:
            try:
                collection = self.db[collection_name]
                
                # Get data
                data_cursor = collection.find().limit(size)
                data_list = list(data_cursor)
                
                if not data_list:
                    print(f"Skipping empty collection: {collection_name}")
                    continue
                
                df = self._process_documents(data_list)
                
                # Generate table name
                table_name = sanitize_table_name(collection_name)
                
                # Load into DuckDB
                self._load_dataframe_to_duckdb(df, table_name)
                
                # Record mapping
                self.loaded_tables[collection_name] = table_name
                print(f"Preloaded collection '{collection_name}' as table '{table_name}' ({len(data_list)} rows)")
                
            except Exception as e:
                print(f"Warning: Failed to preload collection '{collection_name}': {e}")

    def _load_dataframe_to_duckdb(self, df: pd.DataFrame, table_name: str, size: int = 1000000):
        """
        Load DataFrame into DuckDB
        """
        # Create table using a temporary view
        random_suffix = ''.join(rand.choices(string.ascii_letters + string.digits, k=6))
        temp_view_name = f'df_temp_{random_suffix}'

        self.duck_db_conn.register(temp_view_name, df)
        # Use CREATE OR REPLACE to directly replace existing table
        # Quote identifiers to prevent SQL injection
        quoted_table_name = self._quote_identifier(table_name)
        quoted_temp_view = self._quote_identifier(temp_view_name)
        # Ensure size is an integer to prevent injection via size parameter
        safe_size = int(size)
        self.duck_db_conn.execute(f"CREATE OR REPLACE TABLE main.{quoted_table_name} AS SELECT * FROM {quoted_temp_view} LIMIT {safe_size}")
        self.duck_db_conn.execute(f"DROP VIEW {quoted_temp_view}")