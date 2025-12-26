import json
import pandas as pd
import duckdb
from typing import Dict, Any, List
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
        return "Load QC data from local DuckDB file gdis_db.duckdb. Please select date range and click Connect."

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn

        # Attach local DuckDB file
        try:
            self.duck_db_conn.execute("DETACH gcdb;")
        except:
            pass

        try:
            # ✅ FIX: attach đúng file từ Windows
            self.duck_db_conn.execute(r"ATTACH 'D:/DuckDB/gdis_db.duckdb' AS gcdb;")
            print("✅ Attached local DuckDB file: D:/DuckDB/gdis_db.duckdb")
        except Exception as e:
            print(f"❌ Failed to attach DuckDB file: {e}")
            raise

    def list_tables(self):
        try:
            tables_df = self.duck_db_conn.execute("""
                SELECT table_name 
                FROM gcdb.information_schema.tables
                WHERE table_schema = 'main'
            """).fetch_df()
            print
            results = []
            for table_name in tables_df["table_name"].tolist():
                full_table_name = f"gcdb.main.{table_name}"

                columns_df = self.duck_db_conn.execute(f"DESCRIBE {full_table_name}").fetch_df()
                columns = [{"name": c[0], "type": c[1]} for c in columns_df.values]

                sample_df = self.duck_db_conn.execute(f"SELECT * FROM {full_table_name} LIMIT 10").fetch_df()
                sample_rows = json.loads(sample_df.to_json(orient="records"))

                row_count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM {full_table_name}").fetchone()[0]

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
        if name_as is None:
            name_as = table_name.split('.')[-1]
        name_as = sanitize_table_name(name_as)

        query = f"""
            CREATE OR REPLACE TABLE main.{name_as} AS 
            SELECT * FROM {table_name}
        """
        self.duck_db_conn.execute(query)
        return f"✅ Loaded table {table_name} as {name_as}"

    def view_query_sample(self, query: str):
        df = self.duck_db_conn.execute(query + " LIMIT 10").df()
        return json.loads(df.to_json(orient="records"))

    def ingest_data_from_query(self, query: str, name_as: str):
        df = self.duck_db_conn.execute(query).df()
        self.ingest_df_to_duckdb(df, sanitize_table_name(name_as))
        return df
