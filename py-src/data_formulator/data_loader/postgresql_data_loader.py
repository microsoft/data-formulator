import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Dict, Any, List

class PostgreSQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params()  -> List[Dict[str, Any]]:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "postgres", "description": "PostgreSQL username"}, 
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": "PostgreSQL host"}, 
            {"name": "port", "type": "string", "required": False, "default": "5432", "description": "PostgreSQL port"},
            {"name": "database", "type": "string", "required": True, "default": "postgres", "description": "PostgreSQL database name"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return "Provide your PostgreSQL connection details. The user must have SELECT permissions on the tables you want to access."

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        try:
            # Install and load the Postgres extension
            self.duck_db_conn.install_extension("postgres")
            self.duck_db_conn.load_extension("postgres")
            
            # Prepare the connection string for Postgres
            port = self.params.get('port', '5432')
            password_part = f" password={self.params.get('password', '')}" if self.params.get('password') else ""
            attach_string = f"host={self.params['host']} port={port} user={self.params['user']}{password_part} dbname={self.params['database']}"
            
            # Detach existing postgres connection if it exists 
            try:
                self.duck_db_conn.execute("DETACH mypostgresdb;")
            except:
                pass  # Ignore if connection doesn't exist

            # Register Postgres connection
            self.duck_db_conn.execute(f"ATTACH '{attach_string}' AS mypostgresdb (TYPE postgres);")
            print(f"Successfully connected to PostgreSQL database: {self.params['database']}")
            
        except Exception as e:
            print(f"Failed to connect to PostgreSQL: {e}")
            raise

    def list_tables(self):
        try:
            # Query tables through DuckDB's attached PostgreSQL connection
            tables_df = self.duck_db_conn.execute("""
                SELECT table_schema as schemaname, table_name as tablename 
                FROM mypostgresdb.information_schema.tables 
                WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
                AND table_schema NOT LIKE '%_intern%' 
                AND table_schema NOT LIKE '%timescaledb%'
                AND table_name NOT LIKE '%/%'
                AND table_type = 'BASE TABLE'
                ORDER BY table_schema, table_name
            """).fetch_df()
            
            print(f"Found tables: {tables_df}")

            results = []
            
            for schema, table_name in tables_df.values:
                full_table_name = f"mypostgresdb.{schema}.{table_name}"

                try:
                    # Get column information using DuckDB's DESCRIBE
                    columns_df = self.duck_db_conn.execute(f"DESCRIBE {full_table_name}").df()
                    columns = [{
                        'name': row['column_name'],
                        'type': row['column_type']
                    } for _, row in columns_df.iterrows()]
                    
                    # Get sample data
                    sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").df()
                    sample_rows = json.loads(sample_df.to_json(orient="records"))
                    
                    # Get row count
                    row_count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM {full_table_name}").fetchone()[0]

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
                    print(f"Error processing table {full_table_name}: {e}")
                    continue
                    
            return results
            
        except Exception as e:
            print(f"Error listing tables: {e}")
            return []

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000):
        # Create table in the main DuckDB database from Postgres data
        if name_as is None:
            name_as = table_name.split('.')[-1]

        name_as = sanitize_table_name(name_as)

        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE main.{name_as} AS 
            SELECT * FROM {table_name} 
            LIMIT {size}
        """)

    def view_query_sample(self, query: str) -> str:
        return json.loads(self.duck_db_conn.execute(query).df().head(10).to_json(orient="records"))

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        # Execute the query and get results as a DataFrame
        df = self.duck_db_conn.execute(query).df()
        # Use the base class's method to ingest the DataFrame
        self.ingest_df_to_duckdb(df, name_as)
        return df
