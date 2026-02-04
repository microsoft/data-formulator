import json
import logging
from typing import Any
import pandas as pd
import pyarrow as pa

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name

from azure.kusto.data import KustoClient, KustoConnectionStringBuilder
from azure.kusto.data.helpers import dataframe_from_result_table

logger = logging.getLogger(__name__)

class KustoDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> list[dict[str, Any]]:
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

    def __init__(self, params: dict[str, Any]):
        self.params = params
        self.kusto_cluster = params.get("kusto_cluster", None)
        self.kusto_database = params.get("kusto_database", None)

        self.client_id = params.get("client_id", None)
        self.client_secret = params.get("client_secret", None)
        self.tenant_id = params.get("tenant_id", None)

        try:
            if self.client_id and self.client_secret and self.tenant_id:
                self.client = KustoClient(KustoConnectionStringBuilder.with_aad_application_key_authentication(
                    self.kusto_cluster, self.client_id, self.client_secret, self.tenant_id))
            else:
                cluster_url = KustoConnectionStringBuilder.with_az_cli_authentication(self.kusto_cluster)
                logger.info(f"Connecting to Kusto cluster: {self.kusto_cluster}")
                self.client = KustoClient(cluster_url)
                logger.info("Using Azure CLI authentication for Kusto client.")
        except Exception as e:
            logger.error(f"Error creating Kusto client: {e}")
            raise RuntimeError(
                f"Error creating Kusto client: {e}. "
                "Please authenticate with Azure CLI (az login) when starting the app."
            ) from e

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

    def fetch_data_as_arrow(
        self,
        source_table: str,
        size: int = 1000000,
        sort_columns: list[str] | None = None,
        sort_order: str = 'asc'
    ) -> pa.Table:
        """
        Fetch data from Kusto/Azure Data Explorer as a PyArrow Table.
        
        Kusto SDK returns pandas, so we convert to Arrow format.
        
        Args:
            source_table: Kusto table name
            size: Maximum number of rows to fetch
            sort_columns: Columns to sort by
            sort_order: Sort direction
        """
        if not source_table:
            raise ValueError("source_table must be provided")
        
        base_query = f"['{source_table}']"
        
        # Add sort if specified (KQL syntax)
        sort_clause = ""
        if sort_columns and len(sort_columns) > 0:
            order_direction = "desc" if sort_order == 'desc' else "asc"
            sort_cols_with_order = [f"{col} {order_direction}" for col in sort_columns]
            sort_clause = f" | sort by {', '.join(sort_cols_with_order)}"
        
        # Add take limit
        kql_query = f"{base_query}{sort_clause} | take {size}"
        
        logger.info(f"Executing Kusto query: {kql_query[:200]}...")
        
        # Execute query
        df = self.query(kql_query)
        
        # Convert to Arrow
        arrow_table = pa.Table.from_pandas(df, preserve_index=False)
        
        logger.info(f"Fetched {arrow_table.num_rows} rows from Kusto")
        
        return arrow_table

    def list_tables(self, table_filter: str | None = None) -> list[dict[str, Any]]:
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