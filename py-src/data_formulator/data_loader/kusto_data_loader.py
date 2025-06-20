import logging
import sys
from typing import Dict, Any, List
import pandas as pd
import json
import duckdb
import random
import string
from datetime import datetime

from azure.kusto.data import KustoClient, KustoConnectionStringBuilder
from azure.kusto.data.helpers import dataframe_from_result_table

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

# Configure root logger for general application logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)

# Get logger for this module
logger = logging.getLogger(__name__)

class KustoDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> bool:
        params_list = [
            {"name": "kusto_cluster", "type": "string", "required": True, "description": ""}, 
            {"name": "kusto_database", "type": "string", "required": True, "description": ""}, 
            {"name": "client_id", "type": "string", "required": False, "description": "only necessary for AppKey auth"}, 
            {"name": "client_secret", "type": "string", "required": False, "description": "only necessary for AppKey auth"}, 
            {"name": "tenant_id", "type": "string", "required": False, "description": "only necessary for AppKey auth"}
        ]
        return params_list
    
    @staticmethod
    def auth_instructions() -> str:
        return """Azure Kusto Authentication Instructions

Method 1: Azure CLI Authentication
    1. Install Azure CLI: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
    2. Run `az login` in your terminal to authenticate
    3. Ensure you have access to the specified Kusto cluster and database
    4. Leave client_id, client_secret, and tenant_id parameters empty

Method 2: Application Key Authentication
    1. Register an Azure AD application in your tenant
    2. Generate a client secret for the application
    3. Grant the application appropriate permissions to your Kusto cluster:
        - Go to your Kusto cluster in Azure Portal
        - Navigate to Permissions > Add
        - Add your application as a user with appropriate role (e.g., "AllDatabasesViewer" for read access)
    4. Provide the following parameters:
        - client_id: Application (client) ID from your Azure AD app registration
        - client_secret: Client secret value you generated
        - tenant_id: Directory (tenant) ID from your Azure AD

Required Parameters:
    - kusto_cluster: Your Kusto cluster URI (e.g., "https://mycluster.region.kusto.windows.net")
    - kusto_database: Name of the database you want to access
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):

        self.kusto_cluster = params.get("kusto_cluster", None)
        self.kusto_database = params.get("kusto_database", None)
        
        self.client_id = params.get("client_id", None)
        self.client_secret = params.get("client_secret", None)
        self.tenant_id = params.get("tenant_id", None)

        try:
            if self.client_id and self.client_secret and self.tenant_id:
                # This function provides an interface to Kusto. It uses AAD application key authentication.
                self.client = KustoClient(KustoConnectionStringBuilder.with_aad_application_key_authentication(
                    self.kusto_cluster, self.client_id, self.client_secret, self.tenant_id))
            else:
                # This function provides an interface to Kusto. It uses Azure CLI auth, but you can also use other auth types.
                cluster_url = KustoConnectionStringBuilder.with_az_cli_authentication(self.kusto_cluster)
                logger.info(f"Connecting to Kusto cluster: {self.kusto_cluster}")
                self.client = KustoClient(cluster_url)
                logger.info("Using Azure CLI authentication for Kusto client. Ensure you have run `az login` in your terminal.")
        except Exception as e:
            logger.error(f"Error creating Kusto client: {e}")
            raise Exception(f"Error creating Kusto client: {e}, please authenticate with Azure CLI when starting the app.")        
        self.duck_db_conn = duck_db_conn

    def _convert_kusto_datetime_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Convert Kusto datetime columns to proper pandas datetime format"""
        logger.info(f"Processing DataFrame with columns: {list(df.columns)}")
        logger.info(f"Column dtypes before conversion: {dict(df.dtypes)}")
        
        for col in df.columns:
            original_dtype = df[col].dtype
            
            if df[col].dtype == 'object':
                # Try to identify datetime columns by checking sample values
                sample_values = df[col].dropna().head(3)
                if len(sample_values) > 0:
                    # Check if values look like datetime strings or timestamp numbers
                    first_val = sample_values.iloc[0]
                    
                    # Handle Kusto datetime format (ISO 8601 strings)
                    if isinstance(first_val, str) and ('T' in first_val or '-' in first_val):
                        try:
                            # Try to parse as datetime
                            pd.to_datetime(sample_values.iloc[0])
                            logger.info(f"Converting column '{col}' from string to datetime")
                            df[col] = pd.to_datetime(df[col], errors='coerce', utc=True).dt.tz_localize(None)
                        except Exception as e:
                            logger.debug(f"Failed to convert column '{col}' as string datetime: {e}")
                    
                    # Handle numeric timestamps (Unix timestamps in various formats)
                    elif isinstance(first_val, (int, float)) and first_val > 1000000000:
                        try:
                            # Try different timestamp formats
                            if first_val > 1e15:  # Likely microseconds since epoch
                                logger.info(f"Converting column '{col}' from microseconds timestamp to datetime")
                                df[col] = pd.to_datetime(df[col], unit='us', errors='coerce', utc=True).dt.tz_localize(None)
                            elif first_val > 1e12:  # Likely milliseconds since epoch
                                logger.info(f"Converting column '{col}' from milliseconds timestamp to datetime")
                                df[col] = pd.to_datetime(df[col], unit='ms', errors='coerce', utc=True).dt.tz_localize(None)
                            else:  # Likely seconds since epoch
                                logger.info(f"Converting column '{col}' from seconds timestamp to datetime")
                                df[col] = pd.to_datetime(df[col], unit='s', errors='coerce', utc=True).dt.tz_localize(None)
                        except Exception as e:
                            logger.debug(f"Failed to convert column '{col}' as numeric timestamp: {e}")
                            
            # Handle datetime64 columns that might have timezone info
            elif pd.api.types.is_datetime64_any_dtype(df[col]):
                # Ensure timezone-aware datetimes are properly handled
                if hasattr(df[col].dt, 'tz') and df[col].dt.tz is not None:
                    logger.info(f"Converting timezone-aware datetime column '{col}' to UTC")
                    df[col] = df[col].dt.tz_convert('UTC').dt.tz_localize(None)
            
            # Log if conversion happened
            if original_dtype != df[col].dtype:
                logger.info(f"Column '{col}' converted from {original_dtype} to {df[col].dtype}")
        
        logger.info(f"Column dtypes after conversion: {dict(df.dtypes)}")
        return df

    def query(self, kql: str) -> pd.DataFrame:
        logger.info(f"Executing KQL query: {kql} on database {self.kusto_database}")
        result = self.client.execute(self.kusto_database, kql)
        logger.info(f"Query executed successfully, returning results.")
        df = dataframe_from_result_table(result.primary_results[0])
        
        # Convert datetime columns properly
        df = self._convert_kusto_datetime_columns(df)
        
        return df

    def list_tables(self, table_filter: str = None) -> List[Dict[str, Any]]:
        query = ".show tables"
        tables_df = self.query(query)

        tables = []
        for table in tables_df.to_dict(orient="records"):
            table_name = table['TableName']
            
            # Apply table filter if provided
            if table_filter and table_filter.lower() not in table_name.lower():
                continue
                
            schema_result = self.query(f".show table ['{table_name}'] schema as json").to_dict(orient="records")
            columns = [{
                'name': r["Name"],
                'type': r["Type"]
            } for r in json.loads(schema_result[0]['Schema'])['OrderedColumns']]

            row_count_result = self.query(f".show table ['{table_name}'] details").to_dict(orient="records")
            row_count = row_count_result[0]["TotalRowCount"]

            sample_query = f"['{table_name}'] | take {5}"
            sample_df = self.query(sample_query)
            
            # Convert sample data to JSON with proper datetime handling
            sample_result = json.loads(sample_df.to_json(orient="records", date_format='iso'))

            table_metadata = {
                "row_count": row_count,
                "columns": columns,
                "sample_rows": sample_result
            }

            tables.append({
                "type": "table",
                "name": table_name,
                "metadata": table_metadata
            })

        return tables
    
    def ingest_data(self, table_name: str, name_as: str = None, size: int = 5000000) -> pd.DataFrame:
        if name_as is None:
            name_as = table_name
        
        # Create a subquery that applies random ordering once with a fixed seed
        total_rows_ingested = 0
        first_chunk = True
        chunk_size = 100000

        size_estimate_query = f"['{table_name}'] | take {10000} | summarize Total=sum(estimate_data_size(*))"
        size_estimate_result = self.query(size_estimate_query)
        size_estimate = size_estimate_result['Total'].values[0]
        print(f"size_estimate: {size_estimate}")

        chunk_size = min(64 * 1024 * 1024 / size_estimate * 0.9 * 10000, 5000000)
        print(f"estimated_chunk_size: {chunk_size}")

        while total_rows_ingested < size:
            try:
                query = f"['{table_name}'] | serialize | extend rn=row_number() | where rn >= {total_rows_ingested} and rn < {total_rows_ingested + chunk_size} | project-away rn"
                chunk_df = self.query(query)
            except Exception as e:
                chunk_size = int(chunk_size * 0.8)
                continue

            print(f"total_rows_ingested: {total_rows_ingested}")
            print(chunk_df.head())
            
            # Stop if no more data
            if chunk_df.empty:
                break

             # Sanitize the table name for SQL compatibility
            name_as = sanitize_table_name(name_as)
            
            # For first chunk, create new table; for subsequent chunks, append
            if first_chunk:
                self.ingest_df_to_duckdb(chunk_df, name_as)
                first_chunk = False
            else:
                # Append to existing table
                random_suffix = ''.join(random.choices(string.ascii_letters + string.digits, k=6))
                self.duck_db_conn.register(f'df_temp_{random_suffix}', chunk_df)
                self.duck_db_conn.execute(f"INSERT INTO {name_as} SELECT * FROM df_temp_{random_suffix}")
                self.duck_db_conn.execute(f"DROP VIEW df_temp_{random_suffix}")
            
            total_rows_ingested += len(chunk_df)

    def view_query_sample(self, query: str) -> str:
        df = self.query(query).head(10)
        return json.loads(df.to_json(orient="records", date_format='iso'))

    def ingest_data_from_query(self, query: str, name_as: str) -> pd.DataFrame:
        # Sanitize the table name for SQL compatibility
        name_as = sanitize_table_name(name_as)
        df = self.query(query)
        self.ingest_df_to_duckdb(df, name_as)