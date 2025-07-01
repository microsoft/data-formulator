import json
import pandas as pd
import duckdb
import os

from data_formulator.data_loader.external_data_loader import ExternalDataLoader, sanitize_table_name
from typing import Dict, Any, List

class S3DataLoader(ExternalDataLoader):

    @staticmethod
    def list_params() -> List[Dict[str, Any]]:
        params_list = [
            {"name": "aws_access_key_id", "type": "string", "required": True, "default": "", "description": "AWS access key ID"},
            {"name": "aws_secret_access_key", "type": "string", "required": True, "default": "", "description": "AWS secret access key"},
            {"name": "aws_session_token", "type": "string", "required": False, "default": "", "description": "AWS session token (required for temporary credentials)"},
            {"name": "region_name", "type": "string", "required": True, "default": "us-east-1", "description": "AWS region name"},
            {"name": "bucket", "type": "string", "required": True, "default": "", "description": "S3 bucket name"}
        ]
        return params_list

    @staticmethod
    def auth_instructions() -> str:
        return """
**Required AWS Credentials:**
- **AWS Access Key ID**: Your AWS access key identifier
- **AWS Secret Access Key**: Your AWS secret access key  
- **Region Name**: AWS region (e.g., 'us-east-1', 'us-west-2')
- **Bucket**: S3 bucket name
- **AWS Session Token**: Optional, for temporary credentials only

**Getting Credentials:**
1. AWS Console → IAM → Users → Select user → Security credentials → Create access key
2. Choose "Application running outside AWS"

**Required S3 Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::your-bucket-name",
      "arn:aws:s3:::your-bucket-name/*"
    ]
  }]
}
```

**Supported File Formats:**
- CSV files (.csv)
- Parquet files (.parquet) 
- JSON files (.json, .jsonl)

**Security:** Never share secret keys, rotate regularly, use least privilege permissions.
        """

    def __init__(self, params: Dict[str, Any], duck_db_conn: duckdb.DuckDBPyConnection):
        self.params = params
        self.duck_db_conn = duck_db_conn
        
        # Extract parameters
        self.aws_access_key_id = params.get("aws_access_key_id", "")
        self.aws_secret_access_key = params.get("aws_secret_access_key", "")
        self.aws_session_token = params.get("aws_session_token", "")
        self.region_name = params.get("region_name", "us-east-1")
        self.bucket = params.get("bucket", "")
        
        # Install and load the httpfs extension for S3 access
        self.duck_db_conn.install_extension("httpfs")
        self.duck_db_conn.load_extension("httpfs")
        
        # Set AWS credentials for DuckDB
        self.duck_db_conn.execute(f"SET s3_region='{self.region_name}'")
        self.duck_db_conn.execute(f"SET s3_access_key_id='{self.aws_access_key_id}'")
        self.duck_db_conn.execute(f"SET s3_secret_access_key='{self.aws_secret_access_key}'")
        if self.aws_session_token:  # Add this block
            self.duck_db_conn.execute(f"SET s3_session_token='{self.aws_session_token}'")

    def list_tables(self, table_filter: str = None) -> List[Dict[str, Any]]:
        # Use boto3 to list objects in the bucket
        import boto3
        
        s3_client = boto3.client(
            's3',
            aws_access_key_id=self.aws_access_key_id,
            aws_secret_access_key=self.aws_secret_access_key,
            aws_session_token=self.aws_session_token if self.aws_session_token else None,
            region_name=self.region_name
        )
        
        # List objects in the bucket
        response = s3_client.list_objects_v2(Bucket=self.bucket)
        
        results = []
        
        if 'Contents' in response:
            for obj in response['Contents']:
                key = obj['Key']
                
                # Skip directories and non-data files
                if key.endswith('/') or not self._is_supported_file(key):
                    continue
                
                # Apply table filter if provided
                if table_filter and table_filter.lower() not in key.lower():
                    continue
                
                # Create S3 URL
                s3_url = f"s3://{self.bucket}/{key}"
                
                try:
                    # Choose the appropriate read function based on file extension
                    if s3_url.lower().endswith('.parquet'):
                        sample_df = self.duck_db_conn.execute(f"SELECT * FROM read_parquet('{s3_url}') LIMIT 10").df()
                    elif s3_url.lower().endswith('.json') or s3_url.lower().endswith('.jsonl'):
                        sample_df = self.duck_db_conn.execute(f"SELECT * FROM read_json_auto('{s3_url}') LIMIT 10").df()
                    elif s3_url.lower().endswith('.csv'):  # Default to CSV for other formats
                        sample_df = self.duck_db_conn.execute(f"SELECT * FROM read_csv_auto('{s3_url}') LIMIT 10").df()
                    
                    # Get column information
                    columns = [{
                        'name': col,
                        'type': str(sample_df[col].dtype)
                    } for col in sample_df.columns]
                    
                    # Get sample data
                    sample_rows = json.loads(sample_df.to_json(orient="records"))
                    
                    # Estimate row count (this is approximate for CSV files)
                    row_count = self._estimate_row_count(s3_url)
                    
                    table_metadata = {
                        "row_count": row_count,
                        "columns": columns,
                        "sample_rows": sample_rows
                    }
                    
                    results.append({
                        "name": s3_url,
                        "metadata": table_metadata
                    })
                except Exception as e:
                    # Skip files that can't be read
                    print(f"Error reading {s3_url}: {e}")
                    continue
        
        return results
    
    def _is_supported_file(self, key: str) -> bool:
        """Check if the file type is supported by DuckDB."""
        supported_extensions = ['.csv', '.parquet', '.json', '.jsonl']
        return any(key.lower().endswith(ext) for ext in supported_extensions)
    
    def _estimate_row_count(self, s3_url: str) -> int:
        """Estimate the number of rows in a file."""
        try:
            # For parquet files, we can get the exact count
            if s3_url.lower().endswith('.parquet'):
                count = self.duck_db_conn.execute(f"SELECT COUNT(*) FROM read_parquet('{s3_url}')").fetchone()[0]
                return count
            
            # For CSV, JSON, and JSONL files, we'll skip row count
            if s3_url.lower().endswith('.csv') or s3_url.lower().endswith('.json') or s3_url.lower().endswith('.jsonl'):
                return 0
        except Exception as e:
            print(f"Error estimating row count for {s3_url}: {e}")
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