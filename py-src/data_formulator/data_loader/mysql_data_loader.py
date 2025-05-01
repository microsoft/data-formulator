import json

import pandas as pd
import duckdb

from data_formulator.data_loader.external_data_loader import ExternalDataLoader
from typing import Dict, Any

class MySQLDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "user", "type": "string", "required": True, "default": "root"}, 
            {"name": "password", "type": "string", "required": False, "default": ""}, 
            {"name": "host", "type": "string", "required": True, "default": "localhost"}, 
            {"name": "database", "type": "string", "required": True, "default": "mysql"}
        ]
        return params_list

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

        # Register MySQL connection
        self.duck_db_conn.execute(f"ATTACH '{attatch_string}' AS mysqldb (TYPE mysql);")

    def list_tables(self):
        tables_df = self.duck_db_conn.execute(f"""
            SELECT TABLE_SCHEMA, TABLE_NAME FROM mysqldb.information_schema.tables 
            WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        """).fetch_df()

        results = []
        
        for schema, table_name in tables_df.values:

            full_table_name = f"{schema}.{table_name}"

            # Get column information using DuckDB's information schema
            columns_df = self.duck_db_conn.execute(f"DESCRIBE mysqldb.{full_table_name}").df()
            columns = [{
                'name': row['column_name'],
                'type': row['column_type']
            } for _, row in columns_df.iterrows()]
            
            # Get sample data
            sample_df = self.duck_db_conn.execute(f"SELECT * FROM mysqldb.{full_table_name} LIMIT 10").df()
            sample_rows = json.loads(sample_df.to_json(orient="records"))
            
            # get row count
            row_count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM mysqldb.{full_table_name}").fetchone()[0]

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

    def ingest_data(self, table_name: str, name_as: str = None, size: int = 1000000):
        # Create table in the main DuckDB database from MySQL data
        if name_as is None:
            name_as = table_name.split('.')[-1]

        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE {name_as} AS 
            SELECT * FROM mysqldb.{table_name} 
            LIMIT {size}
        """)

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        self.duck_db_conn.execute(f"""
            CREATE OR REPLACE TABLE main.{name_as} AS 
            SELECT * FROM ({query})
        """)