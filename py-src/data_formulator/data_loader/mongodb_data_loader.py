import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from data_formulator.security import validate_sql_query
from typing import Dict, Any, Optional


class MongoDBDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "connection_string", "type": "string", "required": True, "default": "", "description": "MongoDB connection string (mongodb:// or mongodb+srv://)"},
            {"name": "database", "type": "string", "required": True, "default": "", "description": "MongoDB database name"},
            {"name": "collection", "type": "string", "required": False, "default": "", "description": "Specific collection to load (leave empty to list all collections)"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
MongoDB Connection Instructions:

1. Connection String Format:
   - For local MongoDB: mongodb://localhost:27017
   - For MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net
   - Include authentication: mongodb://username:password@host:port/database

2. Authentication:
   - For MongoDB Atlas: Use your cluster username and password
   - For local MongoDB: Create a user with read permissions
   - Ensure your user has read access to the target database

3. Required Parameters:
   - connection_string: Full MongoDB connection string
   - database: Target database name
   - collection: Optional specific collection (leave empty to browse all)

4. Security Considerations:
   - Use strong passwords for database users
   - Enable authentication and authorization
   - Use TLS/SSL connections (mongodb+srv:// automatically uses TLS)
   - Restrict network access to specific IP ranges
   - Use dedicated read-only users for data analysis

5. Troubleshooting:
   - Verify your connection string is correct
   - Ensure your IP is whitelisted in MongoDB Atlas
   - Check that your user has appropriate permissions
   - Test connection using MongoDB Compass or mongosh client
   - For Atlas: Verify cluster is running and accessible
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Install and load the MongoDB extension
        try:
            self.duck_db_conn.install_extension("mongodb")
            self.duck_db_conn.load_extension("mongodb")
        except Exception as e:
            raise Exception(f"MongoDB extension not available. Please install MongoDB extension for DuckDB: {e}")

        connection_string = params.get('connection_string', '')
        if not connection_string:
            raise Exception("MongoDB connection string is required")

        database = params.get('database', '')
        if not database:
            raise Exception("MongoDB database name is required")

        # Build connection string for MongoDB
        attach_string = f"connection_string={connection_string} "
        attach_string += f"database={database}"

        # Detach existing mongodb connection if it exists
        try:
            self.duck_db_conn.execute("DETACH mongodb;")
        except:
            pass  # Ignore if mongodb doesn't exist

        # Register MongoDB connection
        self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS mongodb (TYPE mongodb);")

    def list_tables(self, table_filter: str = None):
        # In MongoDB, "tables" are collections
        try:
            # Try to get collections from the database
            collections_df = self.duck_db_conn.execute("SHOW COLLECTIONS FROM mongodb").fetch_df()
            collections_df.columns = ['collection_name']
        except Exception as e:
            # Fallback: try to list collections using MongoDB system collections
            try:
                collections_df = self.duck_db_conn.execute("""
                    SELECT name as collection_name
                    FROM mongodb.system.namespaces
                    WHERE name NOT LIKE 'system.%'
                """).fetch_df()
            except Exception as e2:
                raise Exception(f"Unable to list collections from MongoDB: {e2}")

        results = []

        for collection_name in collections_df['collection_name'].values:
            full_table_name = f"mongodb.{collection_name}"

            # Apply table filter if provided
            if table_filter and table_filter.lower() not in collection_name.lower():
                continue

            try:
                # Get sample data to infer schema
                sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").df()

                if len(sample_df) > 0:
                    # Infer columns from sample data
                    columns = []
                    for col in sample_df.columns:
                        # Try to infer data type from first non-null value
                        sample_value = None
                        for val in sample_df[col]:
                            if val is not None:
                                sample_value = val
                                break

                        if sample_value is not None:
                            if isinstance(sample_value, (int, float)):
                                col_type = "DOUBLE"
                            elif isinstance(sample_value, bool):
                                col_type = "BOOLEAN"
                            elif isinstance(sample_value, str):
                                col_type = "VARCHAR"
                            else:
                                col_type = "VARCHAR"
                        else:
                            col_type = "VARCHAR"

                        columns.append({
                            'name': col,
                            'type': col_type
                        })

                    sample_rows = json.loads(sample_df.to_json(orient="records"))

                    # Get approximate row count
                    try:
                        row_count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM {full_table_name}").fetchone()[0]
                    except:
                        row_count = -1  # Unknown count

                    table_metadata = {
                        "row_count": row_count,
                        "columns": columns,
                        "sample_rows": sample_rows
                    }

                    results.append({
                        "name": full_table_name,
                        "metadata": table_metadata
                    })
                else:
                    # Empty collection
                    table_metadata = {
                        "row_count": 0,
                        "columns": [],
                        "sample_rows": []
                    }

                    results.append({
                        "name": full_table_name,
                        "metadata": table_metadata
                    })

            except Exception as e:
                # Skip collections that can't be accessed
                continue

        return results

    def ingest_data(self, table_name: str, name_as: Optional[str] = None, size: int = 1000000):
        # Create table in the main DuckDB database from MongoDB collection
        if name_as is None:
            name_as = table_name.split('.')[-1]

        name_as = sanitize_table_name(name_as)

        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE main.{name_as} AS
            SELECT * FROM {table_name}
            LIMIT {size}
        """)

    def view_query_sample(self, query: str) -> str:
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)

        return json.loads(self.duck_db_conn.execute(query).df().head(10).to_json(orient="records"))

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        # Execute the query and get results as a DataFrame
        result, error_message = validate_sql_query(query)
        if not result:
            raise ValueError(error_message)

        df = self.duck_db_conn.execute(query).df()
        # Use the base class's method to ingest the DataFrame
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as))
