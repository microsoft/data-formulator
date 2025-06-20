import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Dict, Any

class MySQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "root", "description": ""}, 
            {"name": "password", "type": "string", "required": False, "default": "", "description": "leave blank for no password"}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost", "description": ""}, 
            {"name": "database", "type": "string", "required": True, "default": "mysql", "description": ""}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
MySQL Connection Instructions:

1. Local MySQL Setup:
   - Ensure MySQL server is running on your machine
   - Default connection: host='localhost', user='root'
   - If you haven't set a root password, leave password field empty

2. Remote MySQL Connection:
   - Obtain host address, username, and password from your database administrator
   - Ensure the MySQL server allows remote connections
   - Check that your IP is whitelisted in MySQL's user permissions

3. Common Connection Parameters:
   - user: Your MySQL username (default: 'root')
   - password: Your MySQL password (leave empty if no password set)
   - host: MySQL server address (default: 'localhost')
   - database: Target database name to connect to

4. Troubleshooting:
   - Verify MySQL service is running: `brew services list` (macOS) or `sudo systemctl status mysql` (Linux)
   - Test connection: `mysql -u [username] -p -h [host] [database]`
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Install and load the MySQL extension
        self.duck_db_conn.install_extension("mysql")
        self.duck_db_conn.load_extension("mysql")
        
        attatch_string = ""
        for key, value in self.params.items():
            if value:
                attatch_string += f"{key}={value} "

        # Detach existing mysqldb connection if it exists
        try:
            self.duck_db_conn.execute("DETACH mysqldb;")
        except:
            pass  # Ignore if mysqldb doesn't exist        # Register MySQL connection
        self.duck_db_conn.execute(f"ATTACH '{attatch_string}' AS mysqldb (TYPE mysql);")

    def list_tables(self, table_filter: str = None):
        tables_df = self.duck_db_conn.execute(f"""
            SELECT TABLE_SCHEMA, TABLE_NAME FROM mysqldb.information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        """).fetch_df()

        results = []
        
        for schema, table_name in tables_df.values:

            full_table_name = f"mysqldb.{schema}.{table_name}"

            # Apply table filter if provided
            if table_filter and table_filter.lower() not in table_name.lower():
                continue

            # Get column information using DuckDB's information schema
            columns_df = self.duck_db_conn.execute(f"DESCRIBE {full_table_name}").df()
            columns = [{
                'name': row['column_name'],
                'type': row['column_type']
            } for _, row in columns_df.iterrows()]
            
            # Get sample data
            sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").df()
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            
            # get row count
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
            
        return results

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000):
        # Create table in the main DuckDB database from MySQL data
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