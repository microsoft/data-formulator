import json
import pandas as pd
import duckdb
import os

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Dict, Any, List

class AzureBlobDataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> List[Dict[str, Any]]:
        params_list = [
            {"name": "account_name", "type": "string", "required": True, "default": "", "description": "Azure storage account name"},
            {"name": "container_name", "type": "string", "required": True, "default": "", "description": "Azure blob container name"},
            {"name": "connection_string", "type": "string", "required": False, "default": "", "description": "Azure storage connection string (alternative to account_name + credentials)"},
            {"name": "credential_chain", "type": "string", "required": False, "default": "cli;managed_identity;env", "description": "Ordered list of Azure credential providers (cli;managed_identity;env)"},
            {"name": "account_key", "type": "string", "required": False, "default": "", "description": "Azure storage account key"},
            {"name": "sas_token", "type": "string", "required": False, "default": "", "description": "Azure SAS token"},
            {"name": "endpoint", "type": "string", "required": False, "default": "blob.core.windows.net", "description": "Azure endpoint override"}
        ]
        return params_list
    
    @staticmethod
    def auth_instructions() -> str:
        return """Authentication Options (choose one)

Option 1 - Connection String (Simplest)
    - Get connection string from Azure Portal > Storage Account > Access keys
    - Use `connection_string` parameter with full connection string
    - `account_name` can be omitted when using connection string

Option 2 - Account Key
    - Get account key from Azure Portal > Storage Account > Access keys
    - Use `account_name` + `account_key` parameters
    - Provides full access to storage account

Option 3 - SAS Token (Recommended for limited access)
    - Generate SAS token from Azure Portal > Storage Account > Shared access signature
    - Use `account_name` + `sas_token` parameters
    - Can be time-limited and permission-scoped

Option 4 - Credential Chain (Most Secure)
    - Use `account_name` + `container_name` only (no explicit credentials)
    - Requires Azure CLI login (`az login` in terminal) or Managed Identity
    - Default chain: `cli;managed_identity;env`
    - Customize with `credential_chain` parameter

Additional Options
    - `endpoint`: Custom endpoint (default: `blob.core.windows.net`)
    - For Azure Government: `blob.core.usgovcloudapi.net`
    - For Azure China: `blob.core.chinacloudapi.cn`

Supported File Formats:
    - CSV files (.csv)
    - Parquet files (.parquet) 
    - JSON files (.json, .jsonl)
"""

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Extract parameters
        self.account_name = params.get("account_name", "")
        self.container_name = params.get("container_name", "")
        self.connection_string = params.get("connection_string", "")
        self.credential_chain = params.get("credential_chain", "cli;managed_identity;env")
        self.account_key = params.get("account_key", "")
        self.sas_token = params.get("sas_token", "")
        self.endpoint = params.get("endpoint", "blob.core.windows.net")
        
        # Install and load the azure extension
        self.duck_db_conn.install_extension("azure")
        self.duck_db_conn.load_extension("azure")
        
        # Set up Azure authentication using secrets (preferred method)
        self._setup_azure_authentication()

    def _setup_azure_authentication(self):
        """Set up Azure authentication using DuckDB secrets."""
        if self.connection_string:
            # Use connection string authentication
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE SECRET azure_secret (
                    TYPE AZURE,
                    CONNECTION_STRING '{self.connection_string}'
                )
            """)
        elif self.account_key:
            # Use account key authentication
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE SECRET azure_secret (
                    TYPE AZURE,
                    ACCOUNT_NAME '{self.account_name}',
                    ACCOUNT_KEY '{self.account_key}'
                )
            """)
        elif self.sas_token:
            # Use SAS token authentication
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE SECRET azure_secret (
                    TYPE AZURE,
                    ACCOUNT_NAME '{self.account_name}',
                    SAS_TOKEN '{self.sas_token}'
                )
            """)
        else:
            # Use credential chain authentication (default)
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE SECRET azure_secret (
                    TYPE AZURE,
                    PROVIDER credential_chain,
                    ACCOUNT_NAME '{self.account_name}',
                    CHAIN '{self.credential_chain}'
                )
            """)

    def list_tables(self, table_filter: str = None) -> List[Dict[str, Any]]:
        # Use Azure SDK to list blobs in the container
        from azure.storage.blob import BlobServiceClient
        
        # Create blob service client based on authentication method
        if self.connection_string:
            blob_service_client = BlobServiceClient.from_connection_string(self.connection_string)
        elif self.account_key:
            blob_service_client = BlobServiceClient(
                account_url=f"https://{self.account_name}.{self.endpoint}",
                credential=self.account_key
            )
        elif self.sas_token:
            blob_service_client = BlobServiceClient(
                account_url=f"https://{self.account_name}.{self.endpoint}",
                credential=self.sas_token
            )
        else:
            # Use default credential chain
            from azure.identity import DefaultAzureCredential
            credential = DefaultAzureCredential()
            blob_service_client = BlobServiceClient(
                account_url=f"https://{self.account_name}.{self.endpoint}",
                credential=credential
            )
        
        container_client = blob_service_client.get_container_client(self.container_name)
        
        # List blobs in the container
        blob_list = container_client.list_blobs()        
        results = []
        
        for blob in blob_list:
            blob_name = blob.name
            
            # Skip directories and non-data files
            if blob_name.endswith('/') or not self._is_supported_file(blob_name):
                continue
            
            # Apply table filter if provided
            if table_filter and table_filter.lower() not in blob_name.lower():
                continue
            
            # Create Azure blob URL
            azure_url = f"az://{self.account_name}.{self.endpoint}/{self.container_name}/{blob_name}"
            
            try:
                # Choose the appropriate read function based on file extension
                if azure_url.lower().endswith('.parquet'):
                    sample_df = self.duck_db_conn.execute(f"SELECT * FROM read_parquet('{azure_url}') LIMIT 10").df()
                elif azure_url.lower().endswith('.json') or azure_url.lower().endswith('.jsonl'):
                    sample_df = self.duck_db_conn.execute(f"SELECT * FROM read_json_auto('{azure_url}') LIMIT 10").df()
                elif azure_url.lower().endswith('.csv'):
                    sample_df = self.duck_db_conn.execute(f"SELECT * FROM read_csv_auto('{azure_url}') LIMIT 10").df()
                
                # Get column information
                columns = [{
                    'name': col,
                    'type': str(sample_df[col].dtype)
                } for col in sample_df.columns]
                
                # Get sample data
                sample_rows = json.loads(sample_df.to_json(orient="records"))
                
                # Estimate row count
                row_count = self._estimate_row_count(azure_url, blob)
                
                table_metadata = {
                    "row_count": row_count,
                    "columns": columns,
                    "sample_rows": sample_rows
                }
                
                results.append({
                    "name": azure_url,
                    "metadata": table_metadata
                })
            except Exception as e:
                # Skip files that can't be read
                print(f"Error reading {azure_url}: {e}")
                continue
        
        return results
    
    def _is_supported_file(self, blob_name: str) -> bool:
        """Check if the file type is supported by DuckDB."""
        supported_extensions = ['.csv', '.parquet', '.json', '.jsonl']
        return any(blob_name.lower().endswith(ext) for ext in supported_extensions)
    
    def _estimate_row_count(self, azure_url: str, blob_properties=None) -> int:
        """Estimate the number of rows in a file using intelligent strategies."""
        try:
            file_extension = azure_url.lower().split('.')[-1]
            
            # For parquet files, use metadata to get exact count efficiently
            if file_extension == 'parquet':
                try:
                    # Use DuckDB's parquet_file_metadata to get exact row count without full scan
                    metadata = self.duck_db_conn.execute(
                        f"SELECT num_rows FROM parquet_file_metadata('{azure_url}')"
                    ).fetchone()
                    if metadata and metadata[0] is not None:
                        return metadata[0]
                except Exception as parquet_error:
                    print(f"Failed to get parquet metadata for {azure_url}: {parquet_error}")
                    # Fall back to counting (expensive but accurate)
                    try:
                        count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM read_parquet('{azure_url}')").fetchone()[0]
                        return count
                    except Exception:
                        pass
            
            # For CSV, JSON, and JSONL files, use intelligent sampling
            elif file_extension in ['csv', 'json', 'jsonl']:
                return self._estimate_rows_by_sampling(azure_url, blob_properties, file_extension)
            
            return 0
            
        except Exception as e:
            print(f"Error estimating row count for {azure_url}: {e}")
            return 0

    def _estimate_rows_by_sampling(self, azure_url: str, blob_properties, file_extension: str) -> int:
        """Estimate row count for text-based files using sampling and file size."""
        try:
            # Get file size from blob properties if available
            file_size_bytes = None
            if blob_properties and hasattr(blob_properties, 'size'):
                file_size_bytes = blob_properties.size
            
            # If no file size available, try a different approach
            if file_size_bytes is None:
                # Sample first 10,000 rows and extrapolate if needed
                return self._estimate_by_row_sampling(azure_url, file_extension)
            
            # Sample approach: read first N rows and estimate based on size
            sample_size = min(10000, file_size_bytes // 100)  # Adaptive sample size
            sample_size = max(1000, sample_size)  # At least 1000 rows
            
            try:
                if file_extension == 'csv':
                    sample_df = self.duck_db_conn.execute(
                        f"SELECT * FROM read_csv_auto('{azure_url}') LIMIT {sample_size}"
                    ).df()
                elif file_extension in ['json', 'jsonl']:
                    sample_df = self.duck_db_conn.execute(
                        f"SELECT * FROM read_json_auto('{azure_url}') LIMIT {sample_size}"
                    ).df()
                else:
                    return 0
                
                sample_rows = len(sample_df)
                if sample_rows == 0:
                    return 0
                    
                # If we got fewer rows than requested, that's probably all there is
                if sample_rows < sample_size:
                    return sample_rows
                
                # Estimate bytes per row from sample
                # For CSV: assume average line length based on file size
                if file_extension == 'csv':
                    # Rough estimate: file_size / (sample_rows * estimated_line_overhead)
                    # CSV overhead includes delimiters, quotes, newlines
                    estimated_bytes_per_row = file_size_bytes / sample_rows * (sample_size / file_size_bytes)
                    estimated_total_rows = int(file_size_bytes / max(estimated_bytes_per_row, 50))  # Min 50 bytes per row
                else:
                    # For JSON: more complex structure, use conservative estimate
                    # Assume JSON overhead is higher
                    estimated_bytes_per_row = file_size_bytes / sample_rows * (sample_size / file_size_bytes)
                    estimated_total_rows = int(file_size_bytes / max(estimated_bytes_per_row, 100))  # Min 100 bytes per row
                
                # Apply reasonable bounds
                estimated_total_rows = max(sample_rows, estimated_total_rows)  # At least as many as we sampled
                estimated_total_rows = min(estimated_total_rows, file_size_bytes // 10)  # Max based on very small rows
                
                return estimated_total_rows
                
            except Exception as e:
                print(f"Error in size-based estimation for {azure_url}: {e}")
                return self._estimate_by_row_sampling(azure_url, file_extension)
                
        except Exception as e:
            print(f"Error in sampling estimation for {azure_url}: {e}")
            return 0

    def _estimate_by_row_sampling(self, azure_url: str, file_extension: str) -> int:
        """Fallback method: sample rows without file size info."""
        try:
            # Try to read a reasonable sample and see if we get less than requested
            # This indicates we've read the whole file
            test_limit = 50000
            
            if file_extension == 'csv':
                sample_df = self.duck_db_conn.execute(
                    f"SELECT * FROM read_csv_auto('{azure_url}') LIMIT {test_limit}"
                ).df()
            elif file_extension in ['json', 'jsonl']:
                sample_df = self.duck_db_conn.execute(
                    f"SELECT * FROM read_json_auto('{azure_url}') LIMIT {test_limit}"
                ).df()
            else:
                return 0
            
            sample_rows = len(sample_df)
            
            # If we got fewer rows than the limit, that's likely the total
            if sample_rows < test_limit:
                return sample_rows
            
            # Otherwise, we can't estimate accurately without more information
            # Return the sample size as a lower bound
            return sample_rows
            
        except Exception as e:
            print(f"Error in row sampling for {azure_url}: {e}")
            return 0

    def ingest_data(self, table_name: str, name_as: str = None, size: int = 1000000):
        if name_as is None:
            name_as = table_name.split('/')[-1].split('.')[0]
        
        name_as = sanitize_table_name(name_as)
        
        # Determine file type and use appropriate DuckDB function
        if table_name.lower().endswith('.csv'):
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE TABLE main.{name_as} AS 
                SELECT * FROM read_csv_auto('{table_name}')
                LIMIT {size}
            """)
        elif table_name.lower().endswith('.parquet'):
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE TABLE main.{name_as} AS 
                SELECT * FROM read_parquet('{table_name}')
                LIMIT {size}
            """)
        elif table_name.lower().endswith('.json') or table_name.lower().endswith('.jsonl'):
            self.duck_db_conn.execute(f"""
                CREATE OR REPLACE TABLE main.{name_as} AS 
                SELECT * FROM read_json_auto('{table_name}')
                LIMIT {size}
            """)
        else:
            raise ValueError(f"Unsupported file type: {table_name}")

    def view_query_sample(self, query: str) -> List[Dict[str, Any]]:
        return self.duck_db_conn.execute(query).df().head(10).to_dict(orient="records")

    def ingest_data_from_query(self, query: str, name_as: str):
        # Execute the query and get results as a DataFrame
        df = self.duck_db_conn.execute(query).df()
        # Use the base class's method to ingest the DataFrame
        self.ingest_df_to_duckdb(df, name_as)