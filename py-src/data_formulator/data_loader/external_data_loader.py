from abc import ABC, abstractmethod
from typing import Dict, Any, List
import pandas as pd
import json
import duckdb
import random
import string
import re

def sanitize_table_name(name_as: str) -> str:
    if not name_as:
        raise ValueError("Table name cannot be empty")
    
    # Remove any SQL injection attempts
    name_as = name_as.replace(";", "").replace("--", "").replace("/*", "").replace("*/", "")
    
    # Replace invalid characters with underscores
    # This includes special characters, spaces, dots, dashes, and other non-alphanumeric chars
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '_', name_as)
    
    # Ensure the name starts with a letter or underscore
    if not sanitized[0].isalpha() and sanitized[0] != '_':
        sanitized = '_' + sanitized
    
    # Ensure the name is not a SQL keyword
    sql_keywords = {
        'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT',
        'OFFSET', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'ON',
        'AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE', 'UNION', 'ALL', 'DISTINCT',
        'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'TABLE', 'VIEW', 'INDEX',
        'ALTER', 'ADD', 'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
        'CONSTRAINT', 'DEFAULT', 'CHECK', 'UNIQUE', 'CASCADE', 'RESTRICT'
    }
    
    if sanitized.upper() in sql_keywords:
        sanitized = '_' + sanitized
    
    # Ensure the name is not too long (common SQL limit is 63 characters)
    if len(sanitized) > 63:
        sanitized = sanitized[:63]
    
    return sanitized

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

    @staticmethod
    @abstractmethod
    def auth_instructions() -> str:
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
    def view_query_sample(self, query: str) -> str:
        pass

    @abstractmethod
    def ingest_data_from_query(self, query: str, name_as: str):
        pass

