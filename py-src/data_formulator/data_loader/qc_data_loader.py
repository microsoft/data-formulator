import os
import json
import pandas as pd
from typing import Dict, Any, List
from clickhouse_connect import get_client
from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

class QCDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> List[Dict[str, Any]]:
        return [
            {
                "name": "from_date",
                "type": "date",
                "required": True,
                "default": "",
                "description": "Ngày bắt đầu (yyyy-mm-dd)"
            },
            {
                "name": "to_date",
                "type": "date",
                "required": True,
                "default": "",
                "description": "Ngày kết thúc (yyyy-mm-dd)"
            },
            {
                "name": "group_item_name",
                "type": "string",
                "required": True,
                "default": "",
                "description": "STDPARAMREPORTNAME"
            },
            {
                "name": "std_param_name",
                "type": "string",
                "required": True,
                "default": "",
                "description": "STDPARAMREPORTNAME"
            },
            {
                "name": "facode_name",
                "type": "string",
                "required": True,
                "default": "",
                "description": "STDPARAMREPORTNAME"
            }
        ]

    @staticmethod
    def auth_instructions() -> str:
        return "Connect to ClickHouse (env: CH_HOST, CH_PORT, CH_USER, CH_PASSWORD). Database=QC_Data. Please select date range and click Connect."

    def __init__(self, params: Dict[str, Any], duck_db_conn):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Read ClickHouse connection from environment
        self.ch_host = os.environ.get("CH_HOST", "172.19.16.23")
        self.ch_port = int(os.environ.get("CH_PORT", "8123"))
        self.ch_user = os.environ.get("CH_USER", "admin")
        self.ch_password = os.environ.get("CH_PASSWORD", "1fEQlaBivOpYXzw#")
        self.ch_db = os.environ.get("CH_DB", "QC_Data")

        try:
            # Create ClickHouse client
            self.ch_client = get_client(host=self.ch_host, port=self.ch_port, username=self.ch_user, password=self.ch_password, database=self.ch_db)
            print(f"Connected to ClickHouse {self.ch_host}:{self.ch_port} db={self.ch_db}")
        except Exception as e:
            print(f"Failed to connect to ClickHouse: {e}")
            raise

    def _normalize_table_identifier(self, table_name: str) -> str:
        """Normalize legacy DuckDB identifiers (e.g. 'gcdb.main.foo' or 'gcdb.foo') or plain table
        names into ClickHouse full identifier 'DB.table' using self.ch_db as the database.
        """
        if not table_name:
            raise ValueError("table_name cannot be empty")

        # If passed like 'gcdb.main.table' or 'gcdb.table', convert to 'CH_DB.table'
        if table_name.startswith("gcdb."):
            parts = table_name.split('.')
            table = parts[-1]
            return f"{self.ch_db}.{table}"

        # If already qualified with another database, leave as-is
        if '.' in table_name and not table_name.startswith('`'):
            return table_name

        # Plain table name -> prefix with ch_db
        return f"{self.ch_db}.{table_name}"

    def list_tables(self, table_filter: str = None):
        try:
            q = f"SELECT name FROM system.tables WHERE database = '{self.ch_db}'"
            if table_filter:
                q += f" AND name LIKE '%{table_filter}%'"

            tables_df = self.ch_client.query_df(q)
            results = []

            for table_name in tables_df["name"].tolist():
                full_table_name = f"{self.ch_db}.{table_name}"

                # Get columns
                columns_df = self.ch_client.query_df(f"DESCRIBE TABLE {full_table_name}")
                columns = [{"name": r['name'], "type": r['type']} for _, r in columns_df.iterrows()]

                # Sample rows
                sample_df = self.ch_client.query_df(f"SELECT * FROM {full_table_name} LIMIT 10")
                sample_rows = json.loads(sample_df.to_json(orient="records")) if not sample_df.empty else []

                # Row count
                row_count_df = self.ch_client.query_df(f"SELECT count() AS c FROM {full_table_name}")
                row_count = int(row_count_df['c'].iloc[0]) if not row_count_df.empty else 0

                results.append({
                    "name": full_table_name,
                    "metadata": {
                        "row_count": row_count,
                        "columns": columns,
                        "sample_rows": sample_rows
                    }
                })

            return results

        except Exception as e:
            print(f"❌ QCDataLoader.list_tables error: {e}")
            return []

    def ingest_data(self, table_name: str, name_as: str | None = None, size: int = 1000000):
        # Normalize legacy table identifiers (e.g., 'gcdb.main.foo') and support plain names
        full_table_name = self._normalize_table_identifier(table_name)
        short_name = full_table_name.split('.')[-1]

        if name_as is None:
            name_as = short_name
        name_as = sanitize_table_name(name_as)

        # Fetch data from ClickHouse
        query = f"SELECT * FROM {full_table_name} LIMIT {size}"
        try:
            df = self.ch_client.query_df(query)
        except Exception as e:
            raise Exception(f"ClickHouse query failed for '{query}': {e}")

        # Ingest into the local DuckDB instance
        self.ingest_df_to_duckdb(df, name_as)
        return f"Loaded table {full_table_name} as {name_as}"

    def view_query_sample(self, query: str):
        # Replace legacy gcdb references if present
        q = query.replace('gcdb.main.', f"{self.ch_db}.").replace('gcdb.', f"{self.ch_db}.")
        q = q.strip()
        if 'limit' not in q.lower():
            q = q + " LIMIT 10"
        try:
            df = self.ch_client.query_df(q)
        except Exception as e:
            raise Exception(f"ClickHouse query failed for '{q}': {e}")
        return json.loads(df.to_json(orient="records"))

    def ingest_data_from_query(self, query: str, name_as: str):
        q = query.replace('gcdb.main.', f"{self.ch_db}.").replace('gcdb.', f"{self.ch_db}.")
        try:
            df = self.ch_client.query_df(q)
        except Exception as e:
            raise Exception(f"ClickHouse query failed for '{q}': {e}")
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as))
        return df
