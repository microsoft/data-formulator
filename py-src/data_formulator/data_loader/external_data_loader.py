from abc import ABC, abstractmethod
from typing import Dict, Any, List
import pandas as pd
import json
import duckdb
import random
import string

class ExternalDataLoader(ABC):
    
    def ingest_df_to_duckdb(self, df: pd.DataFrame, table_name: str):

        base_name = table_name
        counter = 1
        while True:
            # Check if table exists
            exists = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM duckdb_tables() WHERE table_name = '{table_name}'").fetchone()[0] > 0
            if not exists:
                break
            # If exists, append counter to base name
            table_name = f"{base_name}_{counter}"
            counter += 1
    
        # Create table
        random_suffix = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
        self.duck_db_conn.register(f'df_temp_{random_suffix}', df)
        self.duck_db_conn.execute(f"CREATE TABLE {table_name} AS SELECT * FROM df_temp_{random_suffix}")
        self.duck_db_conn.execute(f"DROP VIEW df_temp_{random_suffix}")  # Drop the temporary view after creating the table
    
    @staticmethod
    @abstractmethod
    def list_params() -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        pass

    @abstractmethod
    def list_tables(self) -> List[Dict[str, Any]]:
        # should include: table_name, column_names, column_types, sample_data
        pass

    @abstractmethod
    def ingest_data(self, table_name: str, name_as: str = None, size: int = 1000000):
        pass

    @abstractmethod
    def ingest_data_from_query(self, query: str, name_as: str):
        pass

